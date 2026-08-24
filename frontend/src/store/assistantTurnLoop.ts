import { nanoid } from '@reduxjs/toolkit';

import type { AiToolCall } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { buildContext } from '../features/assistant/context.ts';
import { TOOL_DEFS, type ToolContext } from '../features/assistant/tools/tools.ts';
import { preferredModel } from './assistantAccountThunks.ts';
import { resetCancel, wasCancelled } from './assistantApproval.ts';
import { buildToolContext, prettyArgs, runOneCall } from './assistantRunTool.ts';
import { assistantSaid, noticed, toolAnswered, turnStarted, userSaid } from './assistantSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';
import type { AppDispatch, RootState } from './index.ts';

/**
 * How many tools one turn may call before the loop stops and says so.
 *
 * A ceiling rather than only a Cancel button, because every call here is a real
 * round trip to a real database: a model looping on `getSchema` would hammer the
 * server for as long as nobody was watching, and "nobody was watching" is the
 * normal state of a panel behind a collapsed titlebar toggle.
 */
const MAX_TOOL_CALLS = 30;

/** A turn that calls tools can run for minutes; the bridge's own default would give up first. */
const TURN_TIMEOUT_MS = 5 * 60_000;

function stopRemaining(
    tabId: string,
    dispatch: AppDispatch,
    unanswered: AiToolCall[],
    reason: string,
): void {
    for (const toolCall of unanswered) {
        dispatch(
            toolAnswered({
                tabId,
                callId: toolCall.id,
                name: toolCall.name,
                target: '—',
                outcome: 'stopped',
                args: prettyArgs(toolCall.arguments),
                content: reason,
            }),
        );
    }
}

/**
 * One turn's tool calls, in order. Stops at a cancel or the per-turn ceiling,
 * marking whatever was left as `stopped` rather than leaving it unanswered.
 */
async function handleToolCalls(args: {
    tabId: string;
    toolCalls: AiToolCall[];
    toolContext: ToolContext;
    dispatch: AppDispatch;
    calls: number;
}): Promise<{ stop: boolean; calls: number }> {
    const { tabId, toolCalls, toolContext, dispatch } = args;
    let calls = args.calls;
    for (const [index, toolCall] of toolCalls.entries()) {
        const unanswered = toolCalls.slice(index);
        try {
            if (wasCancelled(tabId)) {
                stopRemaining(
                    tabId,
                    dispatch,
                    unanswered,
                    'The user stopped this turn before this call ran.',
                );
                return { stop: true, calls };
            }
            if (calls >= MAX_TOOL_CALLS) {
                stopRemaining(
                    tabId,
                    dispatch,
                    unanswered,
                    `This turn reached its ceiling of ${MAX_TOOL_CALLS} tool calls and was stopped before this one ran. Say what you had left to do; the user has been told to ask again to continue.`,
                );
                dispatch(
                    noticed({
                        tabId,
                        text: `Stopped after ${MAX_TOOL_CALLS} tool calls. Ask again to continue.`,
                    }),
                );
                return { stop: true, calls };
            }
            calls += 1;
            await runOneCall(tabId, toolCall, toolContext, dispatch);
        } catch (err) {
            stopRemaining(
                tabId,
                dispatch,
                unanswered,
                'The turn ended with an error before this call ran.',
            );
            throw err;
        }
    }
    return { stop: false, calls };
}

async function runConversationLoop(args: {
    tabId: string;
    model: string;
    toolContext: ToolContext;
    dispatch: AppDispatch;
    getState: () => RootState;
}): Promise<true> {
    const { tabId, model, toolContext, dispatch, getState } = args;
    let calls = 0;
    for (;;) {
        if (wasCancelled(tabId)) return true;

        const turnId = nanoid();
        dispatch(turnStarted({ tabId, turnId }));

        const { message } = await call(
            'ai.send',
            {
                turnId,
                model,
                messages: [
                    ...buildContext(getState()),
                    ...(getState().assistant.byTab[tabId]?.messages ?? []),
                ],
                tools: TOOL_DEFS,
            },
            TURN_TIMEOUT_MS,
        );
        dispatch(assistantSaid({ tabId, message }));

        const toolCalls = message.toolCalls ?? [];
        if (!toolCalls.length) return true;

        const outcome = await handleToolCalls({ tabId, toolCalls, toolContext, dispatch, calls });
        calls = outcome.calls;
        if (outcome.stop) return true;
    }
}

export const sendMessage = createAppThunk(
    'assistant/send',
    async (
        { tabId, text }: { tabId: string; text: string },
        { dispatch, getState, rejectWithValue },
    ) => {
        // Which tab failed is read off `action.meta.arg` in the reducer, so the
        // rejection stays the plain string every thunk in this app rejects with.
        const model = getState().assistant.model ?? preferredModel(getState().assistant.models);
        if (!model) return rejectWithValue('No model is available for the stored API key.');

        resetCancel(tabId);
        // A thread earns its stored row on its first message, not when the tab
        // opened: an assistant tab opened and closed without a word leaves nothing
        // behind. Minted here rather than in the reducer, which must stay pure, and
        // by this side rather than by the store, which would answer with an id the
        // debounced save needs before the first write has landed.
        const conversationId = getState().assistant.byTab[tabId]?.id ?? nanoid();
        dispatch(userSaid({ tabId, text, conversationId }));

        const toolContext = buildToolContext(tabId, dispatch, getState);
        try {
            return await runConversationLoop({ tabId, model, toolContext, dispatch, getState });
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);
