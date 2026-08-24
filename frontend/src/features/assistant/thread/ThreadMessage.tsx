import * as t from '../../../common/tokens';
import type { ToolRecord } from '../../../store/assistantSlice.ts';
import type { AiMessage } from '../../../../../shared/protocol/index.ts';
import Prose from '../markdown/Prose.tsx';
import ToolRow from './ToolRow.tsx';

export default function ThreadMessage({
    message,
    tools,
}: {
    message: AiMessage;
    tools: Record<string, ToolRecord>;
}) {
    // A tool *result* is not drawn: the call's own row already stands for it, and
    // the raw JSON below it would be the transcript arguing with itself.
    if (message.role === 'tool') return null;

    if (message.role === 'user') {
        return (
            <div
                style={{
                    alignSelf: 'flex-end',
                    maxWidth: '85%',
                    padding: `${t.GAP_SM}px ${t.GAP}px`,
                    border: `1px solid ${t.BORDER_STRONG}`,
                    borderRadius: t.RADIUS_LG,
                    fontSize: t.TEXT_BODY,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
                {message.content}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_SM }}>
            {message.content ? <Prose text={message.content} /> : null}
            {message.toolCalls?.map((call) => (
                <ToolRow key={call.id} record={tools[call.id]} name={call.name} />
            ))}
        </div>
    );
}
