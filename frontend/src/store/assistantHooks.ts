import { useCallback, useEffect, useMemo } from 'react';

import type {
    AiApprovalMode,
    AiConversationSummary,
    AiProvider,
} from '../../../shared/protocol/index.ts';
import { connect, loadAiStatus, removeKey } from './assistantAccountThunks.ts';
import {
    deleteConversation,
    loadConversations,
    openConversation,
    reachConversation,
} from './assistantConversationThunks.ts';
import {
    APPROVAL_MODE_KEY,
    conversationRestarted,
    EMPTY_CONVERSATION,
    modelChosen,
    selectApprovalMode,
} from './assistantSlice.ts';
import { answerApproval, cancelTurn } from './assistantApproval.ts';
import { sendMessage } from './assistantTurnLoop.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { RootState } from './index.ts';
import { saveSetting } from './settingsSlice.ts';

/**
 * The picker's rows: every kept conversation except **this tab's own**.
 *
 * Only this tab's, and that is a correction. Leaving out every conversation open
 * in *any* tab was the first cut, on the reading that one you are looking at is
 * not a past one — and it made the feature look broken from the second tab: open
 * a new assistant tab and the conversation you were just having is missing from
 * the list, back only once you close the tab holding it. The thing that reading
 * was protecting against is real, but hiding was the wrong instrument for it, and
 * `reachConversation` is the right one: a conversation open elsewhere is listed,
 * and clicking it takes you to the tab that has it.
 *
 * This tab's own stays out, because reopening the thread you are already reading
 * is the one row that could do nothing at all.
 */
export const conversationHistoryFor =
    (tabId: string) =>
    (s: RootState): AiConversationSummary[] => {
        const here = s.assistant.byTab[tabId]?.id;
        return here
            ? s.assistant.history.filter((conversation) => conversation.id !== here)
            : s.assistant.history;
    };

/**
 * The account half: whose key is stored, what models exist, and how much it asks.
 *
 * Split from `useConversation` because these are shared by every assistant tab
 * and by the status bar, which has no tab at all.
 */
export function useAssistantAccount() {
    const dispatch = useAppDispatch();
    const status = useAppSelector((s) => s.assistant.status);
    const connecting = useAppSelector((s) => s.assistant.connecting);
    const models = useAppSelector((s) => s.assistant.models);
    const model = useAppSelector((s) => s.assistant.model);
    const connectError = useAppSelector((s) => s.assistant.connectError);
    const mode = useAppSelector(selectApprovalMode);
    // Any conversation running is what the status bar's dot and the titlebar's
    // mean: with several tabs open, "is the assistant working" is about the app.
    const anyRunning = useAppSelector((s) =>
        Object.values(s.assistant.byTab).some((conversation) => conversation.turnId !== null),
    );

    return {
        status,
        connecting,
        models,
        model,
        connectError,
        mode,
        anyRunning,
        setMode: useCallback(
            (next: AiApprovalMode) =>
                void dispatch(saveSetting({ key: APPROVAL_MODE_KEY, value: next })),
            [dispatch],
        ),
        saveKey: useCallback(
            (provider: AiProvider, key: string) => void dispatch(connect({ provider, key })),
            [dispatch],
        ),
        forgetKey: useCallback(() => void dispatch(removeKey()), [dispatch]),
        refreshStatus: useCallback(() => void dispatch(loadAiStatus()), [dispatch]),
        chooseModel: useCallback((id: string) => void dispatch(modelChosen(id)), [dispatch]),
    };
}

/** One tab's conversation, and the five things you can do to it. */
export function useConversation(tabId: string) {
    const dispatch = useAppDispatch();
    const held = useAppSelector((s) => s.assistant.byTab[tabId]);
    const conversation = held ?? EMPTY_CONVERSATION;
    /**
     * The conversation a *restored* tab was left holding.
     *
     * A one-shot seed the first read consumes, exactly as `Tab.filter` is for a
     * restored grid tab: the tab carries it across the quit, and from the moment
     * it is adopted `assistant.byTab[tabId].id` is the live answer. Nothing writes
     * it back onto the tab, so the two cannot drift.
     */
    const restored = useAppSelector(
        (s) => s.tabs.tabs.find((tab) => tab.id === tabId)?.conversationId,
    );

    // Adopted on the absence of a conversation for this tab, which is true for
    // exactly one render: `openConversation.pending` writes the link, so a second
    // render finds an entry and this does not fire again.
    useEffect(() => {
        if (held || !restored) return;
        void dispatch(openConversation({ tabId, id: restored }));
    }, [dispatch, held, restored, tabId]);

    return {
        ...conversation,
        running: conversation.turnId !== null,
        send: useCallback(
            (text: string) => void dispatch(sendMessage({ tabId, text })),
            [dispatch, tabId],
        ),
        cancel: useCallback(() => void dispatch(cancelTurn(tabId)), [dispatch, tabId]),
        startNew: useCallback(() => dispatch(conversationRestarted(tabId)), [dispatch, tabId]),
        open: useCallback(
            (id: string) => void dispatch(reachConversation({ tabId, id })),
            [dispatch, tabId],
        ),
        approve: useCallback((always: boolean) => answerApproval(tabId, true, always), [tabId]),
        reject: useCallback(() => answerApproval(tabId, false), [tabId]),
    };
}

/**
 * The conversations that can be reopened, and the two things the picker does
 * to them.
 *
 * The list is fetched by `refresh` rather than on mount, because the popup that
 * draws it is what knows when it is about to be looked at -- and a title moves
 * while a thread is running, so a list read once would be stale by the time
 * anyone opened it.
 */
export function useConversationHistory(tabId: string) {
    const dispatch = useAppDispatch();
    const conversations = useAppSelector(useMemo(() => conversationHistoryFor(tabId), [tabId]));

    return {
        conversations,
        refresh: useCallback(() => void dispatch(loadConversations()), [dispatch]),
        remove: useCallback((id: string) => void dispatch(deleteConversation(id)), [dispatch]),
    };
}
