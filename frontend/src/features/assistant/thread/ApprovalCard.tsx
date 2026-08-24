import { useState } from 'react';

import Button from '../../../common/components/Button.tsx';
import { AssistantIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import type { PendingApproval } from '../../../store/assistantSlice.ts';

const cardStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: t.GAP,
    padding: t.GAP_LG,
    border: `1px solid ${t.ACCENT}`,
    borderRadius: t.RADIUS_LG,
    background: t.SELECTED,
};

const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    fontSize: t.TEXT_BODY,
};

const argsStyle: React.CSSProperties = {
    maxHeight: 200,
    margin: 0,
    padding: t.GAP,
    overflow: 'auto',
    border: `1px solid ${t.BORDER}`,
    borderRadius: t.RADIUS,
    color: t.TEXT_MUTED,
    fontFamily: t.MONO,
    fontSize: t.TEXT_BADGE,
};

const alwaysLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    color: t.TEXT_MUTED,
    fontSize: t.TEXT_BADGE,
    cursor: 'pointer',
};

interface Props {
    pending: PendingApproval;
    onApprove: (always: boolean) => void;
    onReject: () => void;
}

export default function ApprovalCard({ pending, onApprove, onReject }: Props) {
    const [always, setAlways] = useState(false);

    return (
        <div data-testid="ai-approval" style={cardStyle}>
            <div style={headerStyle}>
                <AssistantIcon style={{ flex: 'none', width: t.ICON, height: t.ICON }} />
                <span style={{ fontFamily: t.MONO, fontWeight: 600 }}>{pending.name}</span>
                <span style={{ color: t.TEXT_MUTED }}>{pending.target}</span>
            </div>

            <pre style={argsStyle}>{pending.args}</pre>

            {/* Not offered for `getTabResult` at all, and not on a production
          connection: the grant is a convenience, and those are the two places
          this app spends friction rather than saving it. */}
            {pending.offerAlways ? (
                <label style={alwaysLabelStyle}>
                    <input
                        type="checkbox"
                        checked={always}
                        onChange={(e) => setAlways(e.target.checked)}
                    />
                    Allow this tool on this connection for the rest of the conversation
                </label>
            ) : null}

            <div style={{ display: 'flex', gap: t.GAP_SM }}>
                <Button
                    variant="primary"
                    style={{ flex: 1 }}
                    onClick={() => onApprove(always)}
                    data-testid="ai-approve"
                >
                    Approve
                </Button>
                <Button onClick={onReject} data-testid="ai-reject">
                    Reject
                </Button>
            </div>
        </div>
    );
}
