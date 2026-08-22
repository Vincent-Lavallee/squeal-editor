import { type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';

import { CopiedIcon } from '../icons/icons.ts';
import * as t from '../tokens';

/**
 * A checkbox and its label as one target.
 *
 * The box is drawn here rather than by the platform. `accentColor` on a stock
 * checkbox looked right on Windows and wrong on macOS -- WebView2 and WKWebView
 * draw the control itself, at their own size, with their own corner radius and
 * their own tick, and only the fill honours the token. Two platforms wearing two
 * shapes for the same state is the one thing the design system cannot express.
 *
 * It is still a real `<input type="checkbox">`, which is the part that must not
 * be given up: focus, Space, the label association and the form's own value all
 * come from it. `appearance: none` only takes away the paint, and the tick is a
 * sibling rather than a `::after` -- Safari does not render pseudo-elements on an
 * `<input>` at all, which is the very inconsistency this exists to end.
 */
interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'style'> {
    label: ReactNode;
    /** A line beneath, indented to the label. Says what the box does, not that it exists. */
    hint?: ReactNode;
}

const SIZE = 14;

const boxBase: CSSProperties = {
    appearance: 'none',
    WebkitAppearance: 'none',
    flex: 'none',
    width: SIZE,
    height: SIZE,
    margin: 0,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: 3,
    background: t.BG,
    cursor: 'pointer',
};

const tickStyle: CSSProperties = {
    position: 'absolute',
    width: SIZE - 2,
    height: SIZE - 2,
    color: t.ON_ACCENT,
    pointerEvents: 'none',
};

export default function Checkbox({ label, hint, checked, disabled, ...rest }: Props) {
    const on = checked === true;

    return (
        <div>
            <label
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_SM,
                    color: disabled ? t.TEXT_FAINT : t.TEXT_MUTED,
                    fontSize: t.TEXT_BADGE,
                    cursor: disabled ? 'default' : 'pointer',
                }}
            >
                <span
                    style={{
                        position: 'relative',
                        display: 'inline-grid',
                        placeItems: 'center',
                        flex: 'none',
                        width: SIZE,
                        height: SIZE,
                    }}
                >
                    <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        style={{
                            ...boxBase,
                            ...(on ? { background: t.ACCENT, borderColor: t.ACCENT } : {}),
                            ...(disabled
                                ? { borderColor: t.BORDER, cursor: 'default', opacity: 0.6 }
                                : {}),
                        }}
                        {...rest}
                    />
                    {on && <CopiedIcon style={tickStyle} aria-hidden="true" />}
                </span>
                {label}
            </label>
            {hint && (
                <div
                    style={{
                        marginLeft: SIZE + t.GAP_SM,
                        marginTop: 2,
                        color: t.TEXT_FAINT,
                        fontSize: t.TEXT_BADGE,
                    }}
                >
                    {hint}
                </div>
            )}
        </div>
    );
}
