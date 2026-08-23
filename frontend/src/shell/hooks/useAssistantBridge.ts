import { useCallback } from 'react';

import { diagnosePrompt, explainPrompt } from '../../features/assistant/index.ts';
import { sendMessage } from '../../store/assistantSlice.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';

/**
 * Ask the assistant something on the user's behalf: a new conversation, born
 * holding the question.
 *
 * Both callers are elsewhere in the app -- the error under a result grid, a
 * selection in the editor -- and both go through here for the reason every
 * cross-feature gesture does: opening a tab is the tabs', sending a message is
 * the assistant's, and neither feature may import the other.
 *
 * **A new tab every time**, which is what `openAssistantTab` already means: a
 * diagnosis is a new question, and dropping it into a conversation about
 * something else buries both.
 *
 * **It opens in the *other* pane, splitting the view.** This is the one place
 * in the app that does not use `workingPane`, and the exception is the whole
 * point of these two entry points: the question is *about what is on screen*,
 * so an answer that replaces it with itself makes you flip back and forth
 * between the error and the explanation of the error. Beside it, the two are
 * readable together -- which is the gesture `Ctrl+Shift+T` already exists for,
 * taken automatically because here the app is the one deciding to open a tab.
 * With no split yet, minting into the secondary pane is what creates one.
 *
 * **Whether it can be asked at all is decided by the callers**, which draw
 * their control only when a key is stored -- so there is no branch here for
 * the state where nothing could be sent. A button offering to diagnose an
 * error and then opening a form to paste a key into is help that turns into
 * an errand; and queuing the question to fire once a key arrives is real
 * machinery (a prompt with a lifetime, surviving a tab close) for the one
 * state where the assistant does not work at all.
 */
export function useAssistantBridge(args: {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
}) {
    const { openAssistantTab, dispatch } = args.data;
    const { workingPane } = args.layout;

    const askAssistant = useCallback(
        (question: string) => {
            const tabId = openAssistantTab(workingPane === 'secondary' ? 'primary' : 'secondary');
            if (tabId) void dispatch(sendMessage({ tabId, text: question }));
        },
        [openAssistantTab, workingPane, dispatch],
    );

    const diagnoseFailure = useCallback(
        (tab: Tab, failure: { sql: string | null; error: string }) => {
            askAssistant(
                diagnosePrompt({ tabTitle: tab.title, database: tab.database, ...failure }),
            );
        },
        [askAssistant],
    );

    const explainSelection = useCallback(
        (tab: Tab, sql: string) => {
            askAssistant(explainPrompt({ tabTitle: tab.title, database: tab.database, sql }));
        },
        [askAssistant],
    );

    return { askAssistant, diagnoseFailure, explainSelection };
}
