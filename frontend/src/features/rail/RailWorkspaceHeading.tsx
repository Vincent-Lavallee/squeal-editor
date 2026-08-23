import type { WorkspaceIconId } from '../../../../shared/protocol/index.ts';
import { workspaceGlyph } from '../../common/icons/workspaceIcons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    icon: WorkspaceIconId;
    name: string;
}

export default function RailWorkspaceHeading({ icon, name }: Props) {
    const Glyph = workspaceGlyph(icon);
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_XS,
                color: t.TEXT_MUTED,
                fontSize: t.TEXT_MICRO,
                fontWeight: 700,
                lineHeight: 1,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
            }}
        >
            <Glyph style={iconSvg} />
            <span>{name}</span>
        </div>
    );
}
