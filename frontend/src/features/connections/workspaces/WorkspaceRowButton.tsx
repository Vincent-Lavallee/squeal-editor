import type { Workspace } from '../../../../../shared/protocol/index.ts';
import { workspaceGlyph } from '../../../common/icons/workspaceIcons.ts';
import * as t from '../../../common/tokens';
import { countLabel } from './workspaceLabels.ts';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    workspace: Workspace;
    count: number;
    busy: boolean;
    onPick: () => void;
}

export default function WorkspaceRowButton({ workspace, count, busy, onPick }: Props) {
    const Glyph = workspaceGlyph(workspace.icon);

    return (
        <button
            data-testid="saved-pick"
            style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
                padding: `${t.GAP_SM}px 10px`,
                border: 'none',
                background: 'none',
                color: t.TEXT,
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
            }}
            onClick={onPick}
            disabled={busy}
            title={workspace.name}
        >
            <span style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, minWidth: 0 }}>
                <Glyph style={{ ...iconSvg, color: t.TEXT_MUTED }} />
                <span
                    data-testid="saved-name"
                    style={{
                        overflow: 'hidden',
                        fontSize: t.TEXT_BODY,
                        fontWeight: 500,
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {workspace.name}
                </span>
            </span>
            <span
                data-testid="ws-count"
                style={{
                    overflow: 'hidden',
                    color: t.TEXT_MUTED,
                    fontFamily: t.FONT,
                    fontSize: t.TEXT_BADGE,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {countLabel(count)}
            </span>
        </button>
    );
}
