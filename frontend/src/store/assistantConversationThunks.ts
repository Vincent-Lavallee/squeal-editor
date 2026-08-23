import { call } from '../common/bridge/bridge.ts';
import { parseConversation } from './conversationRecord.ts';
import { connectionActivated } from './sessionSlice.ts';
import { tabActivated, tabRenamed } from './tabsSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';
import type { RootState } from './index.ts';

/** The picker's list. Read on every open, since a title and a date both move while a thread runs. */
export const loadConversations = createAppThunk(
    'assistant/history',
    async (_: void, { rejectWithValue }) => {
        try {
            return (await call('conversations.list', {})).conversations;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Which tab is holding a conversation, if any: the live link where the tab has
 * been looked at, the restored seed where it has not.
 *
 * The seed half is not defensive padding. A restored assistant tab does not
 * adopt its conversation until it is first drawn, so a tab sitting in the
 * background genuinely holds one while `byTab` says nothing about it — and
 * reopening that conversation elsewhere would put two tabs on it the moment the
 * background one came to front.
 */
export const tabHoldingConversation = (s: RootState, id: string): string | null =>
    s.tabs.tabs.find((tab) => {
        if (tab.kind !== 'assistant') return false;
        const held = s.assistant.byTab[tab.id];
        return (held ? held.id : tab.conversationId) === id;
    })?.id ?? null;

/**
 * Reach a conversation from the picker.
 *
 * **A conversation already open in another tab is gone *to*, not opened again.**
 * That is what keeps one thread out of two tabs without hiding it from the list:
 * two live threads would take turns saving their own messages over each other's,
 * and the loser is half a conversation rather than a keystroke. The connection
 * is activated alongside the tab, since a tab made active on a server the rail
 * is not showing is a click that appears to do nothing.
 *
 * Everything else loads, below.
 */
export const reachConversation = createAppThunk(
    'assistant/reach',
    async ({ tabId, id }: { tabId: string; id: string }, { dispatch, getState }) => {
        const holder = tabHoldingConversation(getState(), id);
        if (holder === tabId) return;

        if (holder !== null) {
            const tab = getState().tabs.tabs.find((t) => t.id === holder);
            if (tab) {
                dispatch(connectionActivated({ connectionId: tab.connectionId }));
                dispatch(tabActivated({ id: holder }));
                return;
            }
        }
        await dispatch(openConversation({ tabId, id }));
    },
);

/**
 * Put a stored conversation into a tab: the picker's *reopen*, and the way a
 * restored tab gets its thread back.
 *
 * The tab is renamed to what the conversation is called, so the strip says which
 * one is in front — and only when the two differ, since a tab restored from a
 * session snapshot already carries the name it was saved under.
 *
 * A body that no longer resolves is not a failure: an id can outlive its row
 * (deleted from the picker while a tab sat behind it), and the honest reading is
 * a tab that has come from nowhere again. It comes up empty and unlinked, so the
 * next message starts a conversation of its own.
 */
export const openConversation = createAppThunk(
    'assistant/open',
    async (
        { tabId, id }: { tabId: string; id: string },
        { dispatch, getState, rejectWithValue },
    ) => {
        try {
            const { conversation } = await call('conversations.get', { id });
            if (!conversation) return null;

            const tab = getState().tabs.tabs.find((t) => t.id === tabId);
            if (tab && tab.title !== conversation.title)
                dispatch(tabRenamed({ id: tabId, title: conversation.title }));
            return { id: conversation.id, record: parseConversation(conversation.body) };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Write one thread. Dispatched by `conversationSyncListener`, which decides *when*.
 *
 * It answers with the summary rather than just the id, so `history` can be kept
 * current in place. Without that, a conversation started in one tab would be
 * missing from another tab's picker until something happened to re-read the
 * list — which is the same complaint hiding the open ones caused, arriving by a
 * slower route.
 */
export const saveConversation = createAppThunk(
    'assistant/save',
    async (
        { id, title, body }: { id: string; title: string; body: string },
        { rejectWithValue },
    ) => {
        try {
            const { updatedAt } = await call('conversations.save', { id, title, body });
            return { id, title, updatedAt };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Forget one, from the picker.
 *
 * It may be a conversation a *different* tab is holding, now that the list shows
 * those — so the reducer below releases any tab pointing at it, the same answer
 * `deleteSavedQuery` gets from `tabsSlice`. What was deleted is the stored copy,
 * not the thread on screen.
 */
export const deleteConversation = createAppThunk(
    'assistant/delete',
    async (id: string, { rejectWithValue }) => {
        try {
            await call('conversations.delete', { id });
            return id;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);
