import { useState } from 'react';

import * as t from '../../common/tokens';
import type { useAssistantAccount, useConversation } from '../../store/assistantSlice.ts';
import ComposerFooter from './ComposerFooter.tsx';
import ComposerInput from './ComposerInput.tsx';

const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: t.GAP_SM,
    flex: 'none',
    padding: t.GAP_SM,
    borderTop: `1px solid ${t.BORDER}`,
};

interface Props {
    conversation: ReturnType<typeof useConversation>;
    account: ReturnType<typeof useAssistantAccount>;
}

/** The message box, its send/stop button, and the model and approval-mode pickers under it. */
export default function AssistantComposer({ conversation, account }: Props) {
    const [draft, setDraft] = useState('');

    const submit = () => {
        const text = draft.trim();
        if (!text || conversation.running) return;
        setDraft('');
        conversation.send(text);
    };

    return (
        <div style={wrapperStyle}>
            <ComposerInput
                draft={draft}
                onDraftChange={setDraft}
                onSubmit={submit}
                running={conversation.running}
                onCancel={conversation.cancel}
            />
            <ComposerFooter account={account} />
        </div>
    );
}
