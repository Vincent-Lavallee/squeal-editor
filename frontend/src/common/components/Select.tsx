import { type CSSProperties, type SelectHTMLAttributes, useState } from 'react';
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

// A bare select is a chrome control, not a form field: it reads as the label of
// the thing it names until you reach for it. The box it grows is grayscale
// because having focus is not a state worth spending the accent on.
//
// It is shorter than an input because it sits inside a bar rather than in a
// form. At the input's 32px it fills a 32px strip edge to edge and its box
// collides with the strip's own bottom rule.
const bare: CSSProperties = {
  ...base,
  height: 24,
  padding: '0 6px',
  fontWeight: 600,
  borderColor: 'transparent',
};

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  variant?: 'default' | 'bare';
}

export default function Select({
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
    <select
      style={{
        ...(isBare ? bare : base),
        ...(focused && !isBare ? { borderColor: t.ACCENT } : {}),
        ...(isBare && showsBox ? { borderColor: t.BORDER_STRONG } : {}),
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
