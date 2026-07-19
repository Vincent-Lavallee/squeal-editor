import { type CSSProperties, type ReactNode } from 'react';

const clip: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

interface Props {
  children: ReactNode;
}

/** Text visible only to screen readers. */
export default function SrOnly({ children }: Props) {
  return <span style={clip}>{children}</span>;
}
