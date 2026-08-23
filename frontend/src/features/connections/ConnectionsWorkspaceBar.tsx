import type { Workspace } from '../../../../shared/protocol/index.ts';
import { BackIcon } from '../../common/icons/icons.ts';
import { workspaceGlyph } from '../../common/icons/workspaceIcons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

const wsBar: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    width: '100%',
    marginBottom: t.GAP_LG,
    padding: `${t.GAP_SM}px 10px`,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: 'none',
    color: t.TEXT_MUTED,
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
};

interface Props {
    workspace: Workspace;
    busy: boolean;
    onBack: () => void;
}

export default function ConnectionsWorkspaceBar({ workspace, busy, onBack }: Props) {
    const WorkspaceGlyph = workspaceGlyph(workspace.icon);

    return (
        <button
            data-testid="ws-bar"
            style={wsBar}
            onClick={onBack}
            disabled={busy}
            title="All workspaces"
        >
            <BackIcon style={iconSvg} />
            <WorkspaceGlyph style={iconSvg} />
            <span
                data-testid="ws-bar-name"
                style={{
                    overflow: 'hidden',
                    color: t.TEXT,
                    fontSize: t.TEXT_BODY,
                    fontWeight: 500,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {workspace.name}
            </span>
        </button>
    );
}
