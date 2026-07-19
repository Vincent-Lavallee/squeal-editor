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

export default function Input({
  style,
  disabled,
  onFocus,
  onBlur,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);

  return (
    <input
      style={{
        ...base,
        ...(disabled ? { color: t.TEXT_FAINT, borderColor: t.BORDER } : {}),
        ...(focused ? { borderColor: t.ACCENT } : {}),
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
      {...rest}
    />
  );
}
