import type { AiToolCall } from '../../../shared/protocol/index.ts';
import { toolByName, type ToolContext } from '../features/assistant/tools/tools.ts';
import { gateApproval } from './assistantApproval.ts';
import { toolAnswered } from './assistantSlice.ts';
import { errorMessage } from './thunk.ts';
import type { AppDispatch, RootState } from './index.ts';

export const prettyArgs = (json: string): string => {
    try {
        return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
        return json;
    }
};

export function buildToolContext(
    tabId: string,
    dispatch: AppDispatch,
    getState: () => RootState,
): ToolContext {
    return {
        getState,
        dispatch,
        // Which tab is *having* this conversation, so a tool that acts on it --
        // naming it, say -- addresses the right one when two are open.
        conversationTabId: tabId,
        // The one place the editor's global seam is read. It is the primary pane's
        // instance, which is what "the tab in front" already means everywhere else.
        selection: () => {
            const editor = window.squealEditor;
            const range = editor?.getSelection();
            const selected = range ? editor?.getModel()?.getValueInRange(range) : undefined;
            const connectionId = getState().session.activeConnectionId;
            const activeId = connectionId ? getState().tabs.activeTabId[connectionId] : null;
            return selected && activeId ? { tabId: activeId, text: selected } : null;
        },
    };
}

function answerFor(tabId: string, toolCall: AiToolCall, dispatch: AppDispatch) {
    return (
        outcome: 'ran' | 'failed',
        content: string,
        opts?: { name?: string; target?: string; args?: string; stored?: string },
    ) =>
        dispatch(
            toolAnswered({
                tabId,
                callId: toolCall.id,
                name: opts?.name ?? toolCall.name,
                target: opts?.target ?? '—',
                outcome,
                args: opts?.args ?? toolCall.arguments,
                content,
                stored: opts?.stored,
            }),
        );
}

export async function runOneCall(
    tabId: string,
    toolCall: AiToolCall,
    toolContext: ToolContext,
    dispatch: AppDispatch,
): Promise<void> {
    const tool = toolByName(toolCall.name);
    const respond = answerFor(tabId, toolCall, dispatch);

    if (!tool) {
        respond('failed', `No tool named ${toolCall.name}.`);
        return;
    }

    // Malformed JSON is the model's mistake to correct, not the loop's to crash
    // on: it comes back as this call's result and the next turn usually fixes it.
    // The raw string is kept as the row's `args`, unformatted -- it is exactly
    // what could not be parsed, and prettifying it is not available anyway.
    let args: Record<string, unknown>;
    try {
        args = JSON.parse(toolCall.arguments || '{}') as Record<string, unknown>;
    } catch {
        respond('failed', 'Your arguments were not valid JSON. Send them again.', {
            name: tool.def.name,
        });
        return;
    }

    const target = tool.target(args, toolContext);
    const pretty = prettyArgs(toolCall.arguments);
    const named = { name: tool.def.name, target, args: pretty };

    const proceed = await gateApproval({
        tabId,
        tool,
        callId: toolCall.id,
        toolArgs: args,
        target,
        pretty,
        dispatch,
        getState: toolContext.getState,
    });
    if (!proceed) return;

    try {
        // The model gets the answer whole; `summarise` is what the *stored* copy of
        // it says instead, for the one tool whose answer carries database values.
        // Asking the tool rather than deciding here is the rule `mutating` already
        // follows: adding a tool that moves rows cannot quietly add a hole.
        const result = await tool.run(args, toolContext);
        respond('ran', JSON.stringify(result), {
            ...named,
            stored: tool.summarise?.(result, args, toolContext),
        });
    } catch (err) {
        respond('failed', errorMessage(err), named);
    }
}
