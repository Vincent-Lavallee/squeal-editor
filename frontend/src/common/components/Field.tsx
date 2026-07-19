import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

const wrapper: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};

const hintStyle: CSSProperties = {
  textTransform: 'none',
  letterSpacing: 0,
  color: t.TEXT_FAINT,
};

interface Props {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}

export default function Field({ label, htmlFor, hint, children }: Props) {
  return (
    <div style={wrapper}>
      <Label htmlFor={htmlFor}>
        {label}
        {hint && <span style={hintStyle}> {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

/** 11px uppercase muted section label. */
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const style: CSSProperties = {
    fontSize: t.TEXT_LABEL,
    textTransform: 'uppercase',
    letterSpacing: t.TRACKING_LABEL,
    color: t.TEXT_MUTED,
    fontWeight: 500,
  };
  if (htmlFor) {
    return <label style={style} htmlFor={htmlFor}>{children}</label>;
  }
  return <span style={style}>{children}</span>;
}
