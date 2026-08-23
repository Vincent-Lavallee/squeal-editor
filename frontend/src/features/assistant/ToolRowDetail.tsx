import * as t from '../../common/tokens';
import type { ToolRecord } from '../../store/assistantSlice.ts';
import Snippet from './Snippet.tsx';

/**
 * What the second half of an expanded row is called. A stopped call's "result"
 * is the app saying why it never ran, and *Received* over that would read as an
 * answer from a database that was never asked.
 */
const RESULT_LABEL: Record<ToolRecord['outcome'], string> = {
    ran: 'Received',
    rejected: 'Received',
    failed: 'Error',
    stopped: 'Not run',
};

const detailStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: t.GAP_XS,
    margin: `${t.GAP_XS}px 0 0 ${t.ICON + t.GAP_SM}px`,
    paddingLeft: t.GAP_SM,
    borderLeft: `1px solid ${t.BORDER}`,
};

export default function ToolRowDetail({ record }: { record: ToolRecord }) {
    return (
        <div data-testid="ai-tool-detail" style={detailStyle}>
            <Snippet label="Sent" text={record.args} />
            <Snippet
                label={RESULT_LABEL[record.outcome]}
                text={record.result}
                tone={record.outcome === 'failed' ? 'error' : 'normal'}
            />
        </div>
    );
}
