import { isAnyOf, type ActionReducerMapBuilder } from '@reduxjs/toolkit';

import {
    connect,
    loadAiStatus,
    loadModels,
    preferredModel,
    removeKey,
} from './assistantAccountThunks.ts';
import {
    deleteConversation,
    loadConversations,
    openConversation,
    saveConversation,
} from './assistantConversationThunks.ts';
import { blankConversation, conversationFor, type AssistantState } from './assistantSlice.ts';
import { releaseTab, wasCancelled } from './assistantApproval.ts';
import { sendMessage } from './assistantTurnLoop.ts';
import { disconnect } from './sessionSlice.ts';
import { tabsClosed } from './tabsSlice.ts';

function buildAccountReducers(builder: ActionReducerMapBuilder<AssistantState>): void {
    builder
        .addCase(loadAiStatus.fulfilled, (state, action) => {
            state.status = action.payload;
        })
        .addCase(loadAiStatus.rejected, (state, action) => {
            state.status = {
                state: 'unavailable',
                reason: action.payload ?? 'Could not read the stored API key.',
            };
        })
        .addCase(connect.pending, (state) => {
            state.connecting = true;
            state.connectError = null;
        })
        .addCase(connect.fulfilled, (state, action) => {
            state.connecting = false;
            state.status = action.payload;
            // The catalog belongs to the key that just changed, so anything read
            // under the previous one is a picker full of ids the new key cannot send.
            state.models = [];
            state.model = null;
        })
        .addCase(connect.rejected, (state, action) => {
            state.connecting = false;
            state.connectError = action.payload ?? 'That key was not accepted.';
        })
        .addCase(removeKey.fulfilled, (state) => {
            state.status = { state: 'no-key' };
            state.models = [];
            state.model = null;
        })
        .addCase(loadModels.fulfilled, (state, action) => {
            state.models = action.payload;
            state.model ??= preferredModel(action.payload);
        })
        .addCase(loadModels.rejected, (state, action) => {
            state.connectError = action.payload ?? 'Could not read the model catalog.';
        });
}

function buildConversationReducers(builder: ActionReducerMapBuilder<AssistantState>): void {
    builder
        .addCase(loadConversations.fulfilled, (state, action) => {
            state.history = action.payload;
        })
        /*
         * The tab is repointed the instant the fetch starts, not when it lands,
         * and the thread is emptied with it.
         *
         * Linking early is what stops the fetch repeating: `useConversation` fires
         * this off the *absence* of a conversation for the tab, so a link written
         * only on `fulfilled` would leave that absence standing for a round trip.
         *
         * Emptying is the other half and closes a window that would otherwise
         * misfile a whole conversation: between here and `fulfilled` the tab would
         * hold the outgoing thread's messages under the incoming thread's id, and
         * a save landing in that gap writes one over the other. The outgoing one is
         * saved from the pre-action state by `conversationSyncListener`, which
         * watches this action for exactly that reason.
         */
        .addCase(openConversation.pending, (state, action) => {
            state.byTab[action.meta.arg.tabId] = { ...blankConversation(), id: action.meta.arg.id };
        })
        .addCase(openConversation.fulfilled, (state, action) => {
            // A body that no longer resolves, or one that does not parse, leaves the
            // tab empty and unlinked -- the next message is then a conversation of
            // its own rather than an overwrite of a row nobody could read.
            if (!action.payload?.record) {
                state.byTab[action.meta.arg.tabId] = blankConversation();
                return;
            }
            const conversation = conversationFor(state, action.meta.arg.tabId);
            conversation.id = action.payload.id;
            conversation.messages = action.payload.record.messages;
            conversation.tools = action.payload.record.tools;
        })
        /*
         * A failed read **unlinks** the tab rather than leaving it pointing at a
         * conversation it could not fetch. Keeping the link would leave an empty
         * thread holding a real id, and the next message would then write that
         * emptiness over the stored one -- losing the conversation to a transient
         * failure to *read* it. Unlinked, the row stays whole and the picker can
         * be asked again.
         */
        .addCase(openConversation.rejected, (state, action) => {
            state.byTab[action.meta.arg.tabId] = blankConversation();
            conversationFor(state, action.meta.arg.tabId).error =
                action.payload ?? 'Could not reopen that conversation.';
        })
        /*
         * The list is kept current in place rather than re-read, the same shape
         * `saveQuery.fulfilled` has: the row is replaced when it is one already
         * held and prepended otherwise, then re-sorted. Newest first, so a
         * conversation returned to moves back to the top — which is the order the
         * picker exists to give.
         */
        .addCase(saveConversation.fulfilled, (state, action) => {
            const at = state.history.findIndex(
                (conversation) => conversation.id === action.payload.id,
            );
            if (at === -1) state.history.push(action.payload);
            else state.history[at] = action.payload;
            state.history.sort((a, b) => b.updatedAt - a.updatedAt);
        })
        /*
         * A deleted conversation **releases the tab holding it** rather than
         * leaving it pointing at a row that is gone -- `deleteSavedQuery`'s rule,
         * and it became reachable the moment the picker stopped hiding
         * conversations open elsewhere. The messages stay on screen, because what
         * was deleted is the stored copy and not the thread being read; the next
         * message files a conversation of its own. A tab restored but not yet
         * drawn needs nothing here: its seed resolves to `null` on adoption, which
         * already unlinks it.
         */
        .addCase(deleteConversation.fulfilled, (state, action) => {
            state.history = state.history.filter(
                (conversation) => conversation.id !== action.payload,
            );
            for (const conversation of Object.values(state.byTab)) {
                if (conversation.id === action.payload) conversation.id = null;
            }
        });
}

function buildTurnReducers(builder: ActionReducerMapBuilder<AssistantState>): void {
    builder
        .addCase(sendMessage.fulfilled, (state, action) => {
            const conversation = state.byTab[action.meta.arg.tabId];
            if (!conversation) return;
            conversation.turnId = null;
            conversation.streaming = '';
            conversation.pending = null;
        })
        .addCase(sendMessage.rejected, (state, action) => {
            const tabId = action.meta.arg.tabId;
            const conversation = state.byTab[tabId];
            if (!conversation) return;
            conversation.turnId = null;
            conversation.streaming = '';
            conversation.pending = null;
            // A cancel is not a failure and must not paint one: the user asked.
            if (!wasCancelled(tabId))
                conversation.error = action.payload ?? 'The assistant failed.';
        })
        /*
         * Anything keyed by tab is dropped when the tab goes -- the rule `sqlByTab`
         * already follows, and for its reason: `tabsClosed` and
         * `disconnect.fulfilled` are every way a tab leaves, and a conversation
         * left behind is a thread nothing can reach and nothing will collect.
         *
         * Matched on the action *creators* rather than on their type strings, so
         * renaming either is a compile error here rather than a leak nobody sees.
         */
        .addMatcher(isAnyOf(tabsClosed, disconnect.fulfilled), (state, action) => {
            const ids = 'ids' in action.payload ? action.payload.ids : action.payload.tabIds;
            for (const id of ids) {
                delete state.byTab[id];
                releaseTab(id);
            }
        });
}

export function buildAssistantExtraReducers(
    builder: ActionReducerMapBuilder<AssistantState>,
): void {
    buildAccountReducers(builder);
    buildConversationReducers(builder);
    buildTurnReducers(builder);
}
