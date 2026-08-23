import { useEffect, useRef, useState } from 'react';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import * as t from '../../common/tokens';

// `userSelect` back on: the cells around it are `none` so a drag selects them
// rather than sweeping text, and an input inheriting that cannot have its own
// text selected -- including by the `select()` below.
const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_XS,
    width: '100%',
    userSelect: 'text',
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: t.TEXT,
    fontFamily: t.MONO,
    fontSize: t.TEXT_BODY,
    caretColor: t.ACCENT,
};

const nullButtonStyle: React.CSSProperties = {
    flex: 'none',
    padding: '0 2px',
    border: 'none',
    background: 'transparent',
    color: t.TEXT_FAINT,
    fontSize: t.TEXT_BODY,
    cursor: 'pointer',
};

interface Props {
    initial: CellValue;
    canNull: boolean;
    onCommit: (draft: string) => void;
    onNull: () => void;
    onCancel: () => void;
}

export default function CellEditor({ initial, canNull, onCommit, onNull, onCancel }: Props) {
    const [draft, setDraft] = useState(initial === null ? '' : String(initial));
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);

    return (
        <span style={wrapperStyle}>
            <input
                ref={ref}
                data-testid="cell-edit-input"
                style={inputStyle}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => onCommit(draft)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        onCommit(draft);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onCancel();
                    } else if (canNull && (e.ctrlKey || e.metaKey) && e.key === 'Delete') {
                        e.preventDefault();
                        onNull();
                    }
                }}
            />
            {canNull && (
                <button
                    type="button"
                    data-testid="cell-edit-null"
                    style={nullButtonStyle}
                    title="Set NULL (Ctrl+Delete)"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onNull();
                    }}
                >
                    ∅
                </button>
            )}
        </span>
    );
}
