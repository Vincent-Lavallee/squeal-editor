/**
 * One assistant tab's body: a bar, the thread, and the composer.
 *
 * **A tab is a conversation**, so everything here is keyed by the tab it is
 * drawn in and several may be open at once. What is *not* per-tab is the
 * account — whose key is stored, the catalog, the chosen model, the approval
 * mode — which is why it arrives through a second hook.
 */

import { useEffect } from 'react';

import * as t from '../../common/tokens';
import { loadModels, useAssistantAccount, useConversation } from '../../store/assistantSlice.ts';
import { useAppDispatch } from '../../store/hooks.ts';
import AssistantBar from './AssistantBar.tsx';
import AssistantComposer from './composer/AssistantComposer.tsx';
import Connect from './connect/Connect.tsx';
import Thread from './thread/Thread.tsx';
import { latestContextTokens } from './tokenCount.ts';

export default function AssistantPanel({ tabId }: { tabId: string }) {
    const dispatch = useAppDispatch();
    const account = useAssistantAccount();
    const conversation = useConversation(tabId);

    const { status } = account;
    const ready = status?.state === 'ready';
    const contextTokens = latestContextTokens(conversation.messages);

    // The catalog is read once a key is stored, not at launch: it is that key's
    // catalog, so asking before there is one would only ever fail. Several tabs
    // asking is one fetch's worth of waste and no correctness problem.
    useEffect(() => {
        if (ready) void dispatch(loadModels());
    }, [dispatch, ready]);

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                height: '100%',
            }}
            data-testid="assistant-panel"
        >
            <AssistantBar
                tabId={tabId}
                contextTokens={contextTokens}
                ready={ready}
                conversation={conversation}
            />

            {status === null ? (
                <div style={{ padding: t.GAP_XL, color: t.TEXT_FAINT, fontSize: t.TEXT_BODY }}>
                    Checking for an API key…
                </div>
            ) : !ready ? (
                <Connect
                    status={status}
                    connecting={account.connecting}
                    error={account.connectError}
                    onConnect={account.saveKey}
                />
            ) : (
                <>
                    <Thread
                        messages={conversation.messages}
                        tools={conversation.tools}
                        streaming={conversation.streaming}
                        running={conversation.running}
                        pending={conversation.pending}
                        error={conversation.error}
                        onApprove={conversation.approve}
                        onReject={conversation.reject}
                    />
                    <AssistantComposer conversation={conversation} account={account} />
                </>
            )}
        </div>
    );
}
