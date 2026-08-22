import { type ButtonHTMLAttributes, type CSSProperties, useState } from 'react';
import * as t from '../tokens';

type Variant = 'default' | 'primary' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
}

const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    height: t.BUTTON_H,
    padding: '0 12px',
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BADGE,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
};

const variantStyles: Record<Variant, CSSProperties> = {
    default: {},
    primary: {
        background: t.ACCENT,
        borderColor: t.ACCENT,
        color: t.ON_ACCENT,
        fontWeight: 600,
    },
    ghost: {
        borderColor: 'transparent',
        background: 'transparent',
        color: t.TEXT_MUTED,
    },
};

const hoverStyles: Record<Variant, CSSProperties> = {
    default: { background: t.HOVER },
    primary: { background: t.ACCENT_HOVER },
    ghost: { background: t.HOVER, color: t.TEXT },
};

const disabledStyles: Record<Variant, CSSProperties> = {
    default: { color: t.TEXT_FAINT, cursor: 'default' },
    primary: {
        background: t.ACCENT,
        borderColor: t.ACCENT,
        color: t.ON_ACCENT,
        opacity: 0.45,
    },
    ghost: { color: t.TEXT_FAINT, cursor: 'default' },
};

export default function Button({
    variant = 'default',
    // A `<button>` inside a `<form>` is a submit button unless it says otherwise,
    // so every Cancel and every side action in a form was submitting it as well as
    // doing its own job -- silently, because the submit usually failed or the
    // handler navigated away first. The one button that means it says so.
    type = 'button',
    style,
    disabled,
    onMouseEnter,
    onMouseLeave,
    ...rest
}: Props) {
    const [hovered, setHovered] = useState(false);

    const v = variantStyles[variant];
    const h = !disabled && hovered ? hoverStyles[variant] : {};
    const d = disabled ? disabledStyles[variant] : {};

    return (
        <button
            type={type}
            style={{ ...base, ...v, ...h, ...d, ...style }}
            disabled={disabled}
            onMouseEnter={(e) => {
                setHovered(true);
                onMouseEnter?.(e);
            }}
            onMouseLeave={(e) => {
                setHovered(false);
                onMouseLeave?.(e);
            }}
            {...rest}
        />
    );
}
