import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';

import {
    assistantSaid,
    conversationRestarted,
    noticed,
    openConversation,
    saveConversation,
    toolAnswered,
    userSaid,
} from './assistantSlice.ts';
import { toStored } from './conversationRecord.ts';
import { disconnect } from './sessionSlice.ts';
import { tabRenamed, tabsClosed } from './tabsSlice.ts';
import type { AppDispatch, RootState } from './index.ts';

/**
 * Persist each open conversation as it is had, so it can be reopened after a
 * quit -- the write half of the assistant's memory.
 *
 * `sessionSyncListener`'s shape and its reasons, one slice over: a listener
 * rather than a hook because it watches *state* and has to see the whole store
 * (the title it writes is the tab's, which is a different slice from the
 * messages), and debounced because a streaming turn lands several actions a
 * second and a write per action is a write per token.
 *
 * What it writes is **not** the conversation as it stands: `toStored` reduces
 * every attached result to its shape first. That is the rule the feature exists
 * around, and it lives in `conversationRecord.ts` rather than here so the shape
 * and its redaction cannot be changed apart.
 */
export const conversationSyncMiddleware = createListenerMiddleware();
const startAppListening = conversationSyncMiddleware.startListening.withTypes<
    RootState,
    AppDispatch
>();

/** How long a conversation sits still before it is written. `sessionSyncListener`'s. */
const DEBOUNCE_MS = 600;

/** What was last written per conversation id, so an unchanged thread is not saved again. */
const lastSaved = new Map<string, string>();

/**
 * Write every conversation in `state` that has changed since it was last
 * written.
 *
 * **A thread with no messages is never written**, which is what keeps three
 * cases from each costing a row: an assistant tab opened and never spoken to, a
 * thread the user just cleared, and a tab whose stored body failed to load. The
 * last is the one that matters -- linked but empty, it would otherwise write
 * that emptiness over a real conversation.
 */
function saveChanged(state: RootState, dispatch: AppDispatch): void {
    for (const [tabId, conversation] of Object.entries(state.assistant.byTab)) {
        if (!conversation.id || conversation.messages.length === 0) continue;

        const body = JSON.stringify(toStored(conversation));
        if (lastSaved.get(conversation.id) === body) continue;
        lastSaved.set(conversation.id, body);

        // The tab's name is the conversation's: the model writes it there on its
        // first reply (`renameConversation`) and the user can edit it in the strip,
        // so reading it back is what keeps one name for one thing.
        const title = state.tabs.tabs.find((tab) => tab.id === tabId)?.title ?? 'Conversation';
        void dispatch(saveConversation({ id: conversation.id, title, body }));
    }
}

// Debounced: everything that adds to a thread, plus the rename that titles it.
startAppListening({
    matcher: isAnyOf(userSaid, assistantSaid, toolAnswered, noticed, tabRenamed),
    effect: async (_action, api) => {
        api.cancelActiveListeners();
        await api.delay(DEBOUNCE_MS);
        saveChanged(api.getState(), api.dispatch);
    },
});

/**
 * Immediate, and read from **before** the action landed.
 *
 * Each of these four empties a conversation out of a tab, so by the time the
 * reducers have run there is nothing left to serialise -- and the debounce above
 * would have missed the last exchange of a thread ended within 600ms of it.
 * `getOriginalState` is the pre-action store, which is exactly the last moment
 * the thread was there; it is this listener's answer to what `disconnect.pending`
 * is for the session one.
 *
 * `openConversation.pending` is the one that is not obvious: reopening a past
 * conversation *into a tab that holds one* replaces the thread, so the outgoing
 * one has to be written on the way out, exactly as a closing tab's is.
 */
startAppListening({
    matcher: isAnyOf(
        tabsClosed,
        disconnect.fulfilled,
        conversationRestarted,
        openConversation.pending,
    ),
    effect: (_action, api) => {
        saveChanged(api.getOriginalState(), api.dispatch);
    },
});
