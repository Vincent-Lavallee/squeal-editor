/**
 * The assistant: the conversation, and the loop that advances it.
 *
 * A slice by the usual test -- every message crossed the bridge, since the
 * extension is what sent it. What is *not* here is the panel's own furniture
 * (whether it is open, how wide it is), which has never left the webview.
 *
 * **The loop runs on this side**, which is the design's one surprising part and
 * has one reason: nine of the fifteen tools answer from the tabs, the editor
 * selection and the results, none of which the extension has heard of. The
 * extension holds the API key and makes the request; deciding what to do with
 * the answer is up here, where the answer is about things that live up here. See
 * `docs/decisions.md`.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { buildAssistantExtraReducers } from './assistantExtraReducers.ts';
import type { ToolRecord } from './conversationRecord.ts';
import type { RootState } from './index.ts';
import type {
    AiApprovalMode,
    AiConversationSummary,
    AiMessage,
    AiModel,
    AiStatus,
} from '../../../shared/protocol/index.ts';

export {
    loadAiStatus,
    connect,
    removeKey,
    loadModels,
    preferredModel,
} from './assistantAccountThunks.ts';
export {
    loadConversations,
    tabHoldingConversation,
    reachConversation,
    openConversation,
    saveConversation,
    deleteConversation,
} from './assistantConversationThunks.ts';
export { sendMessage } from './assistantTurnLoop.ts';
export { answerApproval, cancelTurn } from './assistantApproval.ts';
export {
    conversationHistoryFor,
    useAssistantAccount,
    useConversation,
    useConversationHistory,
} from './assistantHooks.ts';
export type { ToolRecord } from './conversationRecord.ts';

export interface PendingApproval {
    callId: string;
    name: string;
    target: string;
    /** The model's arguments, pretty-printed, so the card can show exactly what was asked for. */
    args: string;
    /**
     * The connection the grant would cover, or null when the call names none.
     *
     * A grant is **per connection** so it cannot travel to a server the user was
     * not thinking about when they gave it.
     */
    connectionId: string | null;
    /**
     * Whether "allow for this conversation" may be offered at all.
     *
     * False on a `production` connection, where the app already treats the
     * environment as a reason for more friction rather than less -- the same line
     * the `auto` approval mode draws.
     */
    offerAlways: boolean;
}

/**
 * One conversation, which is one assistant tab's.
 *
 * **Keyed by tab, not global.** It shipped as a single thread every tab was a
 * window onto, which is why opening a second one used to focus the first
 * instead: two identical views of one conversation is not a second tab, it is
 * the same tab drawn twice. Once several tabs are worth having, each has to be
 * worth having *something different in it* -- so a tab is a conversation, the
 * way a tab is a query. See `docs/decisions.md`.
 *
 * Everything above this in `AssistantState` is about the **account** — who is
 * signed in, what models exist, which one is chosen — and stays singular,
 * because none of it is a fact about one thread.
 */
export interface Conversation {
    /**
     * The stored row this thread is, or `null` while it is nothing yet.
     *
     * Minted on the first message rather than when the tab opens, so an assistant
     * tab opened and closed without a word leaves nothing behind. It is what
     * `conversations.save` writes under and what a restored tab is reopened from,
     * so it outlives the tab id everything else here is keyed by — the same split
     * `Tab.savedQueryId` draws between a runtime id and a stored one.
     */
    id: string | null;
    /** The conversation as the model sees it, minus the context rebuilt each turn. */
    messages: AiMessage[];
    tools: Record<string, ToolRecord>;
    turnId: string | null;
    /** The text of the answer being generated, before it lands as a message. */
    streaming: string;
    pending: PendingApproval | null;
    autoApproved: string[];
    error: string | null;
}

export interface AssistantState {
    /** Null until the launch read lands, so the UI can tell "not yet" from "no key stored". */
    status: AiStatus | null;
    connecting: boolean;
    models: AiModel[];
    model: string | null;
    /** A failure of the *key* — connecting, a catalog read — as opposed to one thread's. */
    connectError: string | null;
    /**
     * Keyed by tab id, and **pruned when the tab closes** — the rule everything
     * keyed by a tab here follows, so the store never holds threads for tabs it
     * cannot enumerate. `tabsClosed` and `disconnect.fulfilled` are the two ways a
     * tab leaves, and both are matched below.
     */
    byTab: Record<string, Conversation>;
    /**
     * Every kept conversation, newest first, **without its body** — what the
     * history popup draws.
     *
     * Re-read each time that popup opens rather than held behind a `loaded` flag
     * the way the saved queries are: a title and a timestamp both move while a
     * conversation is being had, so a list cached once at launch is a list of
     * yesterday's names.
     */
    history: AiConversationSummary[];
}

export const blankConversation = (): Conversation => ({
    id: null,
    messages: [],
    tools: {},
    turnId: null,
    streaming: '',
    pending: null,
    autoApproved: [],
    error: null,
});

/** The conversation for a tab, minted on first use — a tab that has never been asked anything has none. */
export const conversationFor = (state: AssistantState, tabId: string): Conversation =>
    (state.byTab[tabId] ??= blankConversation());

export const EMPTY_CONVERSATION: Conversation = blankConversation();

/**
 * The approval mode's settings key, and the reason it is a setting at all.
 *
 * Unlike `autoApproved` -- a grant that belongs to one conversation and dies
 * with it -- this is how the user wants to work, so it outlives a thread and a
 * restart. `manual` is the default for a key nobody has written.
 */
export const APPROVAL_MODE_KEY = 'assistant.approvalMode';

/**
 * Whether a question can actually be sent right now.
 *
 * A boolean and not the status object, because its reader is `Shell` — asking
 * for the whole slice there would re-render the composition root on every
 * streaming delta, and what it needs is one flag that moves twice a session.
 */
export const selectAssistantReady = (s: RootState): boolean =>
    s.assistant.status?.state === 'ready';

/** Read from the settings slice rather than mirrored here, so there is one source for it. */
export const selectApprovalMode = (s: {
    settings: { values: Record<string, string> };
}): AiApprovalMode => {
    const stored = s.settings.values[APPROVAL_MODE_KEY];
    return stored === 'auto' || stored === 'bypass' ? stored : 'manual';
};

const initialState: AssistantState = {
    status: null,
    connecting: false,
    models: [],
    model: null,
    connectError: null,
    byTab: {},
    history: [],
};

const assistantSlice = createSlice({
    name: 'assistant',
    initialState,
    reducers: {
        userSaid(
            state,
            action: PayloadAction<{ tabId: string; text: string; conversationId: string }>,
        ) {
            const conversation = conversationFor(state, action.payload.tabId);
            // `??=`, so the id is the first message's and every message after it is
            // filed under the same one. A thread that already has a row keeps it.
            conversation.id ??= action.payload.conversationId;
            conversation.messages.push({ role: 'user', content: action.payload.text });
            conversation.error = null;
        },
        assistantSaid(state, action: PayloadAction<{ tabId: string; message: AiMessage }>) {
            const conversation = conversationFor(state, action.payload.tabId);
            conversation.messages.push(action.payload.message);
            conversation.streaming = '';
        },
        toolAnswered(
            state,
            action: PayloadAction<
                Omit<ToolRecord, 'result'> & { tabId: string; callId: string; content: string }
            >,
        ) {
            const { tabId, callId, content, ...record } = action.payload;
            const conversation = conversationFor(state, tabId);
            conversation.messages.push({ role: 'tool', toolCallId: callId, content });
            // `record.stored` rides along and is deliberately *not* written over
            // `result`: the thread on screen shows what the model was given, and the
            // shape is what reaches the disk. See `conversationRecord.ts`.
            conversation.tools[callId] = { ...record, result: content };
            conversation.pending = null;
        },
        noticed(state, action: PayloadAction<{ tabId: string; text: string }>) {
            conversationFor(state, action.payload.tabId).messages.push({
                role: 'assistant',
                content: action.payload.text,
            });
        },
        turnStarted(state, action: PayloadAction<{ tabId: string; turnId: string }>) {
            const conversation = conversationFor(state, action.payload.tabId);
            conversation.turnId = action.payload.turnId;
            conversation.streaming = '';
        },
        /**
         * A delta finds its conversation by the turn it names, rather than carrying a
         * tab id of its own.
         *
         * The broadcast comes from the extension, which has never heard of a tab —
         * and the turn id it echoes is unique across every conversation, so the
         * lookup is exact. It also self-corrects: a delta for a turn that has already
         * landed, or whose tab has closed, matches nothing and is dropped.
         */
        deltaReceived(state, action: PayloadAction<{ turnId: string; text: string }>) {
            const conversation = Object.values(state.byTab).find(
                (entry) => entry.turnId === action.payload.turnId,
            );
            if (conversation) conversation.streaming += action.payload.text;
        },
        approvalRequested(state, action: PayloadAction<PendingApproval & { tabId: string }>) {
            const { tabId, ...pending } = action.payload;
            conversationFor(state, tabId).pending = pending;
        },
        autoApproved(state, action: PayloadAction<{ tabId: string; connectionId: string }>) {
            const conversation = conversationFor(state, action.payload.tabId);
            if (!conversation.autoApproved.includes(action.payload.connectionId))
                conversation.autoApproved.push(action.payload.connectionId);
        },
        modelChosen(state, action: PayloadAction<string>) {
            state.model = action.payload;
        },
        /**
         * This tab moves on to a new conversation.
         *
         * **Nothing is destroyed by it**, which is why the control is a `+` and not
         * a bin: the thread being left keeps its stored row and turns up in the
         * history picker. The `id` is dropped so the next message starts a
         * conversation of its own rather than writing over the one left behind, and
         * `autoApproved` goes with it, because the grant was for *that conversation*
         * -- carrying it into a fresh one would be a blanket permission nobody gave.
         *
         * Deleting a conversation is a different gesture, in that picker.
         */
        conversationRestarted(state, action: PayloadAction<string>) {
            state.byTab[action.payload] = blankConversation();
        },
    },
    extraReducers: buildAssistantExtraReducers,
});

export const {
    approvalRequested,
    assistantSaid,
    autoApproved,
    conversationRestarted,
    deltaReceived,
    modelChosen,
    noticed,
    toolAnswered,
    turnStarted,
    userSaid,
} = assistantSlice.actions;

export const assistantReducer = assistantSlice.reducer;
