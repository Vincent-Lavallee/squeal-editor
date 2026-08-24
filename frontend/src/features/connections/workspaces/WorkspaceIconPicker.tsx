import type { WorkspaceIconId } from '../../../../../shared/protocol/index.ts';
import { WORKSPACE_ICONS } from '../../../common/icons/workspaceIcons.ts';
import * as t from '../../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };
const hiddenRadio: React.CSSProperties = {
    position: 'absolute',
    opacity: 0,
    pointerEvents: 'none',
};
const pickBase: React.CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: 34,
    height: 34,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    cursor: 'pointer',
};

interface Props {
    icon: WorkspaceIconId;
    onChange: (icon: WorkspaceIconId) => void;
}

export default function WorkspaceIconPicker({ icon, onChange }: Props) {
    return (
        <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: t.GAP_SM }}
            role="radiogroup"
            aria-label="Icon"
        >
            {WORKSPACE_ICONS.map(({ id, Glyph }) => {
                const on = icon === id;
                return (
                    <label
                        key={id}
                        className="ws-icons__pick"
                        style={{
                            ...pickBase,
                            color: t.TEXT_MUTED,
                            ...(on
                                ? { borderColor: t.ACCENT, background: t.SELECTED, color: t.ACCENT }
                                : {}),
                        }}
                    >
                        <input
                            type="radio"
                            name="workspace-icon"
                            value={id}
                            checked={on}
                            onChange={() => onChange(id)}
                            style={hiddenRadio}
                        />
                        <Glyph style={iconSvg} />
                    </label>
                );
            })}
        </div>
    );
}
