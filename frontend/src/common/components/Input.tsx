import { type CSSProperties, type InputHTMLAttributes, useState } from 'react';
import * as t from '../tokens';

const base: CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 9px',
  border: `1px solid ${t.BORDER_STRONG}`,
  borderRadius: t.RADIUS,
  background: t.BG,
  color: t.TEXT,
  font: 'inherit',
  fontSize: t.TEXT_BODY,
  outline: 'none',
};

// The chrome form, matching `<Select variant="bare">` exactly: no box at rest,
// 24px so it fits inside a bar, growing a grayscale outline on hover and focus.
// Use it where the field sits in the chrome rather than in a form -- there,
// focus is a real state and keeps the accent.
const bare: CSSProperties = {
  ...base,
  height: 24,
  padding: '0 6px',
  borderColor: 'transparent',
};

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'bare';
}

export default function Input({
  variant = 'default',
  style,
  disabled,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const isBare = variant === 'bare';
  const showsBox = focused || (hovered && !disabled);

  return (
    <input
      style={{
        ...(isBare ? bare : base),
        ...(disabled ? { color: t.TEXT_FAINT, borderColor: t.BORDER } : {}),
        ...(focused && !isBare ? { borderColor: t.ACCENT } : {}),
        ...(isBare && showsBox && !disabled ? { borderColor: t.BORDER_STRONG } : {}),
        ...(style ?? {}),
      }}
      disabled={disabled}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
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
