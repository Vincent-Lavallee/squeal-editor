import { useEffect, useRef, useState } from 'react';

import type { CellValue } from '../../../../../shared/protocol/index.ts';
import * as t from '../../../common/tokens';
import { handleCellEditorKey } from './cellEditorKeys.ts';

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
    fontFamily: t.MONO_DATA,
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
    onUseDefault?: () => void;
    onCancel: () => void;
}

export default function CellEditor({
    initial,
    canNull,
    onCommit,
    onNull,
    onUseDefault,
    onCancel,
}: Props) {
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
                onKeyDown={(e) =>
                    handleCellEditorKey(e, { draft, canNull, onCommit, onNull, onCancel })
                }
            />
            {onUseDefault && (
                <button
                    type="button"
                    data-testid="cell-edit-default"
                    style={nullButtonStyle}
                    title="Use the database default"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onUseDefault();
                    }}
                >
                    ↺
                </button>
            )}
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
