import { useState } from 'react';
import type { MenuItem } from '../../../../common/components/ContextMenu.tsx';
import type { Menu } from '../resultsGridTypes.ts';

interface Options {
    selected: Set<number>;
    setSelected: (rows: Set<number>) => void;
    anchor: React.MutableRefObject<number | null>;
    setCells: (cells: null) => void;
    setEditing: (cell: null) => void;
    editable: boolean;
    canCopyAsSql: boolean;
    copyRows: (rowIndices: number[]) => void;
    copyRowsAsSql: (rowIndices: number[]) => void;
    isDeleted: (r: number) => boolean;
    isKeyCol: (c: number) => boolean;
    setNull: (row: number, col: number) => void;
    toggleDelete: (row: number) => void;
}

/**
 * The grid's right-click menu: opening it, and what it offers for the row(s)
 * or cell it was opened on. Split out of `ResultsTable` purely for length.
 */
export function useGridMenuState(options: Options) {
    const { selected, setSelected, anchor, setCells, setEditing } = options;
    const {
        editable,
        canCopyAsSql,
        copyRows,
        copyRowsAsSql,
        isDeleted,
        isKeyCol,
        setNull,
        toggleDelete,
    } = options;
    const [menu, setMenu] = useState<Menu | null>(null);

    const openMenu = (r: number, c: number | null) => (e: React.MouseEvent) => {
        e.preventDefault();
        setCells(null);
        if (!selected.has(r)) {
            setSelected(new Set([r]));
            anchor.current = r;
        }
        setEditing(null);
        setMenu({ row: r, col: c, x: e.clientX, y: e.clientY });
    };

    const menuItems = (m: Menu): MenuItem[] => {
        const rows = selected.size > 0 ? [...selected].sort((a, b) => a - b) : [m.row];
        const items: MenuItem[] = [
            {
                label: rows.length > 1 ? `Copy ${rows.length} rows` : 'Copy row',
                onSelect: () => copyRows(rows),
            },
        ];
        if (canCopyAsSql) items.push({ label: 'Copy as SQL', onSelect: () => copyRowsAsSql(rows) });
        if (editable) {
            if (m.col !== null)
                items.push({
                    label: 'Set NULL',
                    disabled: isDeleted(m.row) || isKeyCol(m.col),
                    onSelect: () => setNull(m.row, m.col!),
                });
            items.push({
                label: isDeleted(m.row) ? 'Keep row' : 'Delete row',
                danger: !isDeleted(m.row),
                onSelect: () => toggleDelete(m.row),
            });
        }
        return items;
    };

    return { menu, setMenu, openMenu, menuItems };
}
