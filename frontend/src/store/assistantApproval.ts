import type { Tool } from '../features/assistant/tools/toolHelpers.ts';
import {
    approvalRequested,
    autoApproved,
    selectApprovalMode,
    toolAnswered,
} from './assistantSlice.ts';
import { call } from '../common/bridge/bridge.ts';
import { createAppThunk } from './thunk.ts';
import type { AppDispatch, RootState } from './index.ts';

/**
 * The loop pauses here, and this is what un-pauses it.
 *
 * Module-level rather than in the state for the reason the bridge's own pending
 * map is: a promise resolver is not serialisable and nothing renders from it.
 * The state holds what the *card* needs; this holds the continuation.
 *
 * **Keyed by tab**, now that several conversations can be in flight at once: one
 * resolver would have a card answered in one tab releasing the loop parked in
 * another.
 */
const awaitingDecision = new Map<
    string,
    (decision: { approved: boolean; always: boolean }) => void
>();

/** Which tabs have been asked to stop. Per tab for `awaitingDecision`'s reason. */
const cancelled = new Set<string>();

/** Answer one tab's card. A stray click on a tab parked on nothing finds no resolver and no-ops. */
export function answerApproval(tabId: string, approved: boolean, always = false): void {
    awaitingDecision.get(tabId)?.({ approved, always });
    awaitingDecision.delete(tabId);
}

export function releaseTab(tabId: string): void {
    awaitingDecision.delete(tabId);
    cancelled.delete(tabId);
}

/** Whether the user asked to stop this tab's turn -- a cancel must not paint as a failure. */
export function wasCancelled(tabId: string): boolean {
    return cancelled.has(tabId);
}

export function cancelTabTurn(tabId: string): void {
    cancelled.add(tabId);
}

/** A new send always starts uncancelled, even if the previous turn was stopped. */
export function resetCancel(tabId: string): void {
    cancelled.delete(tabId);
}

/**
 * Stop the turn in flight.
 *
 * Two halves, and both are needed: `ai.cancel` aborts the request the extension
 * has open, and the flag stops the loop from starting another one. Aborting
 * alone would leave the loop to take the rejection and carry on to the next tool
 * call it had already decided to make.
 */
export const cancelTurn = createAppThunk(
    'assistant/cancel',
    async (tabId: string, { getState }) => {
        cancelTabTurn(tabId);
        const turnId = getState().assistant.byTab[tabId]?.turnId ?? null;
        // A loop parked on a card is released as a refusal, so cancelling while an
        // approval is up ends the turn rather than leaving it waiting forever.
        awaitingDecision.get(tabId)?.({ approved: false, always: false });
        awaitingDecision.delete(tabId);
        if (turnId) await call('ai.cancel', { turnId }).catch(() => undefined);
        return tabId;
    },
);

/**
 * Only a tool that *does* something asks. Reading is never gated -- not the
 * schema, not the tabs, and not the rows either: a card in front of every
 * lookup is a card nobody reads by the third one, which is worse than no card
 * because it looks like a guard. See `docs/decisions.md`.
 */
export async function gateApproval(args: {
    tabId: string;
    tool: Tool;
    callId: string;
    toolArgs: Record<string, unknown>;
    target: string;
    pretty: string;
    dispatch: AppDispatch;
    getState: () => RootState;
}): Promise<boolean> {
    const { tabId, tool, callId, toolArgs, target, pretty, dispatch, getState } = args;
    if (tool.mutating !== true) return true;

    const state = getState();
    const connectionId =
        typeof toolArgs.connectionId === 'string'
            ? toolArgs.connectionId
            : (state.session.activeConnectionId ?? null);
    const isProduction =
        connectionId !== null &&
        state.session.connections[connectionId]?.environment === 'production';
    // The grant belongs to *this* conversation, so a second assistant tab starts
    // with none of the permissions the first was given.
    const granted =
        connectionId !== null &&
        (state.assistant.byTab[tabId]?.autoApproved.includes(connectionId) ?? false);
    const mode = selectApprovalMode(state);

    // `bypass` skips everything; `auto` skips everything but production, which is
    // the one distinction between the two modes. A grant from an earlier card in
    // this conversation counts the same as `auto` and is scoped the same way.
    const skip = mode === 'bypass' || ((mode === 'auto' || granted) && !isProduction);
    if (skip) return true;

    const decision = await new Promise<{ approved: boolean; always: boolean }>((resolve) => {
        awaitingDecision.set(tabId, resolve);
        dispatch(
            approvalRequested({
                tabId,
                callId,
                name: tool.def.name,
                target,
                args: pretty,
                connectionId,
                offerAlways: !isProduction,
            }),
        );
    });

    if (!decision.approved) {
        dispatch(
            toolAnswered({
                tabId,
                callId,
                name: tool.def.name,
                target,
                outcome: 'rejected',
                args: pretty,
                content: 'The user declined this. Do not retry it; ask them what to do instead.',
            }),
        );
        return false;
    }
    if (decision.always && connectionId) dispatch(autoApproved({ tabId, connectionId }));
    return true;
}
