import type { ConnectionColorId } from '../../../../../shared/protocol/index.ts';
import { CONNECTION_COLORS, connectionColor } from '../../../common/icons/connectionColors.ts';
import { CloseIcon } from '../../../common/icons/icons.ts';
import Field from '../../../common/components/Field.tsx';
import SrOnly from '../../../common/components/SrOnly.tsx';
import * as t from '../../../common/tokens';
import { hiddenRadio, iconGlyph, swatchDot, swatchTile } from './connectionColorSwatchStyles.ts';

interface Props {
    color: ConnectionColorId;
    onChange: (color: ConnectionColorId) => void;
    onClose: () => void;
}

export default function ConnectionColorPicker({ color, onChange, onClose }: Props) {
    return (
        <Field label="Color">
            <div
                className="conn-colors"
                style={{ display: 'flex', gap: t.GAP_XS }}
                role="radiogroup"
                aria-label="Color"
            >
                {CONNECTION_COLORS.map(({ id }) => {
                    const on = color === id;
                    return (
                        <label
                            key={id}
                            className="conn-colors__pick"
                            style={{
                                ...swatchTile,
                                ...(on ? { borderColor: t.ACCENT, background: t.SELECTED } : {}),
                            }}
                        >
                            <input
                                type="radio"
                                name="connection-color"
                                value={id}
                                checked={on}
                                style={hiddenRadio}
                                onChange={() => {
                                    onChange(id);
                                    onClose();
                                }}
                            />
                            <span
                                aria-hidden="true"
                                style={{ ...swatchDot, background: connectionColor(id) }}
                            />
                            <SrOnly>{id}</SrOnly>
                        </label>
                    );
                })}
                <button
                    type="button"
                    data-testid="color-close"
                    aria-label="Keep the current color"
                    style={{ ...swatchTile, marginLeft: 'auto', color: t.TEXT_MUTED }}
                    onClick={onClose}
                >
                    <CloseIcon style={iconGlyph} aria-hidden="true" />
                </button>
            </div>
        </Field>
    );
}
