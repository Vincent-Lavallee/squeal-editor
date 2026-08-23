import { useEffect, useRef, useState } from 'react';
import type { CellValue } from '../../../../shared/protocol/index.ts';
import type { Cell } from './resultsGridTypes.ts';

interface Options {
    editable: boolean;
    missingKeyHint: string | null;
    isJsonCol: (c: number) => boolean;
    isKeyCol: (c: number) => boolean;
    isDeleted: (r: number) => boolean;
    original: (r: number, c: number) => CellValue;
    setCell: (row: number, col: number, value: CellValue) => void;
    clearCell: (row: number, col: number) => void;
}

function makeCellEdits(options: Pick<Options, 'isKeyCol' | 'original' | 'setCell' | 'clearCell'>) {
    const { isKeyCol, original, setCell, clearCell } = options;
    const applyEdit = (row: number, col: number, draft: string) => {
        const orig = original(row, col);
        if (orig !== null && draft === String(orig)) clearCell(row, col);
        else setCell(row, col, draft);
    };
    const applyNull = (row: number, col: number) => {
        if (isKeyCol(col)) return;
        if (original(row, col) === null) clearCell(row, col);
        else setCell(row, col, null);
    };
    return { applyEdit, applyNull };
}

function makeStartEdit(args: {
    editable: boolean;
    missingKeyHint: string | null;
    isJsonCol: (c: number) => boolean;
    isDeleted: (r: number) => boolean;
    setEditing: (cell: Cell | null) => void;
    setJsonEditing: (cell: Cell | null) => void;
    setEditBlockedHint: (hint: string | null) => void;
    editBlockedTimeout: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
    const {
        editable,
        missingKeyHint,
        isJsonCol,
        isDeleted,
        setEditing,
        setJsonEditing,
        setEditBlockedHint,
        editBlockedTimeout,
    } = args;
    return (r: number, c: number) => {
        if (isDeleted(r)) return;
        if (!editable) {
            // Only a real attempt earns the hint -- `missingKeyHint` has been true
            // since the query ran, and showing it unprompted would read as the app
            // scolding a result nobody meant to edit. Shown for a few seconds, the
            // same shape a toast would take, rather than left to sit in the bar.
            if (missingKeyHint) {
                setEditBlockedHint(missingKeyHint);
                if (editBlockedTimeout.current) clearTimeout(editBlockedTimeout.current);
                editBlockedTimeout.current = setTimeout(() => setEditBlockedHint(null), 4000);
            }
            return;
        }
        if (isJsonCol(c)) setJsonEditing({ row: r, col: c });
        else setEditing({ row: r, col: c });
    };
}

/**
 * Which cell is being edited (inline or in the JSON drawer), and the hint
 * shown when an edit is attempted but blocked. Split out of `ResultsTable`
 * purely for length.
 */
export function useGridEditingState({
    editable,
    missingKeyHint,
    isJsonCol,
    isKeyCol,
    isDeleted,
    original,
    setCell,
    clearCell,
}: Options) {
    const [editing, setEditing] = useState<Cell | null>(null);
    const [jsonEditing, setJsonEditing] = useState<Cell | null>(null);
    // Set only by a blocked edit attempt (`startEdit` below), never by
    // `missingKeyHint` changing on its own -- an unattempted edit says nothing.
    const [editBlockedHint, setEditBlockedHint] = useState<string | null>(null);
    const editBlockedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (editBlockedTimeout.current) clearTimeout(editBlockedTimeout.current);
        },
        [],
    );

    const reset = () => {
        setEditing(null);
        setJsonEditing(null);
        setEditBlockedHint(null);
    };

    const { applyEdit, applyNull } = makeCellEdits({ isKeyCol, original, setCell, clearCell });
    const startEdit = makeStartEdit({
        editable,
        missingKeyHint,
        isJsonCol,
        isDeleted,
        setEditing,
        setJsonEditing,
        setEditBlockedHint,
        editBlockedTimeout,
    });

    const commit = (row: number, col: number, draft: string) => {
        applyEdit(row, col, draft);
        setEditing(null);
    };
    const setNull = (row: number, col: number) => {
        applyNull(row, col);
        setEditing(null);
    };

    return {
        editing,
        setEditing,
        jsonEditing,
        setJsonEditing,
        editBlockedHint,
        reset,
        applyEdit,
        applyNull,
        startEdit,
        commit,
        setNull,
    };
}
