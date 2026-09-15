import { useState } from 'react';
import type { MenuItem } from '../../../../common/components/ContextMenu.tsx';
import { rangeBounds, type CellRange, type Menu } from '../resultsGridTypes.ts';

interface Options {
    selected: Set<number>;
    setSelected: (rows: Set<number>) => void;
    anchor: React.MutableRefObject<number | null>;
    selectedCols: Set<number>;
    setSelectedCols: (cols: Set<number>) => void;
    cells: CellRange | null;
    setCells: (cells: CellRange | null) => void;
    setEditing: (cell: null) => void;
    editable: boolean;
    columns: string[];
    rowCount: number;
    colCount: number;
    copyRows: (rowIndices: number[]) => void;
    copyColumns: (colIndices: number[]) => void;
    copyCells: (range: CellRange) => void;
    copyAsSql: (rowIndices: number[], colIndices: number[]) => void;
    isDeleted: (r: number) => boolean;
    isKeyCol: (c: number) => boolean;
    setNull: (row: number, col: number) => void;
    toggleDelete: (row: number) => void;
    hideColumns: (colIndices: number[]) => void;
}

const inRange = (range: CellRange, r: number, c: number): boolean => {
    const b = rangeBounds(range);
    return r >= b.top && r <= b.bottom && c >= b.left && c <= b.right;
};

const indexRange = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

const copyColumnNameItem = (m: Menu, columns: string[]): MenuItem[] =>
    m.col !== null
        ? [
              {
                  label: 'Copy column name',
                  onSelect: () => void Neutralino.clipboard.writeText(columns[m.col!] ?? ''),
              },
          ]
        : [];

// Shared by all three "open a menu" cases below: dropping every selection
// before whichever one the click actually means gets set.
function clearAllSelections(o: Options): void {
    o.setSelected(new Set());
    o.setSelectedCols(new Set());
    o.setCells(null);
}

/**
 * Which selection is opening the menu right now -- one of the three mutually
 * exclusive states `useGridSelection` holds, read in priority order: a
 * column selection beats a cell/rectangle/everything selection, which beats
 * the row-selection fallback.
 */
function openMenuFor(m: { r: number; c: number | null }, o: Options): void {
    const { r, c } = m;
    if (c === null) {
        // The row gutter: a click already inside the row selection leaves it
        // alone, otherwise it starts a fresh one-row selection.
        if (!o.selected.has(r)) {
            clearAllSelections(o);
            o.setSelected(new Set([r]));
            o.anchor.current = r;
        }
    } else if (o.selectedCols.has(c)) {
        // Already part of the active column selection -- keep it.
    } else if (o.cells && inRange(o.cells, r, c)) {
        // Already part of the active cell/column/everything rectangle -- keep it.
    } else {
        clearAllSelections(o);
        o.setCells({ anchor: { row: r, col: c }, focus: { row: r, col: c } });
    }
}

// Opened directly from a header, rather than from a cell already inside the
// column: a click already inside the active column selection leaves it
// alone (so a multi-column selection's menu still covers all of them),
// otherwise it starts a fresh one-column selection.
function openColumnMenuFor(c: number, o: Options): void {
    if (!o.selectedCols.has(c)) {
        clearAllSelections(o);
        o.setSelectedCols(new Set([c]));
    }
}

// Opened from the corner cell: always selects everything, the same as a
// plain click there -- there is no "already selected" case to preserve
// since the corner only ever means the whole grid.
function selectEverythingFor(o: Options): void {
    clearAllSelections(o);
    o.setCells({ anchor: { row: 0, col: 0 }, focus: { row: o.rowCount - 1, col: o.colCount - 1 } });
}

function rowMenuItems(m: Menu, o: Options): MenuItem[] {
    const rows = o.selected.size > 0 ? [...o.selected].sort((a, b) => a - b) : [m.row];
    const allCols = indexRange(0, o.colCount - 1);
    const items: MenuItem[] = [
        {
            label: rows.length > 1 ? `Copy ${rows.length} rows values` : 'Copy row values',
            onSelect: () => o.copyRows(rows),
        },
        { label: 'Copy as SQL insert', onSelect: () => o.copyAsSql(rows, allCols) },
    ];
    if (o.editable) {
        items.push({
            label: o.isDeleted(m.row) ? 'Keep row' : 'Delete row',
            danger: !o.isDeleted(m.row),
            onSelect: () => o.toggleDelete(m.row),
        });
    }
    return items;
}

function columnMenuItems(m: Menu, o: Options): MenuItem[] {
    const cols = [...o.selectedCols].sort((a, b) => a - b);
    const allRows = indexRange(0, o.rowCount - 1);
    return [
        {
            label: cols.length > 1 ? `Copy ${cols.length} columns values` : 'Copy column values',
            onSelect: () => o.copyColumns(cols),
        },
        { label: 'Copy as SQL insert', onSelect: () => o.copyAsSql(allRows, cols) },
        ...copyColumnNameItem(m, o.columns),
        {
            label: cols.length > 1 ? `Hide ${cols.length} columns` : 'Hide column',
            onSelect: () => o.hideColumns(cols),
        },
    ];
}

function cellMenuItems(m: Menu, o: Options): MenuItem[] {
    if (!o.cells) return [];
    const { top, bottom, left, right } = rangeBounds(o.cells);
    const rowIndices = indexRange(top, bottom);
    const colIndices = indexRange(left, right);
    const isSingleCell = rowIndices.length === 1 && colIndices.length === 1;
    const isEverything = rowIndices.length === o.rowCount && colIndices.length === o.colCount;
    const isFullColumn = colIndices.length === 1 && rowIndices.length === o.rowCount;
    const copyLabel = isEverything
        ? `Copy ${rowIndices.length} × ${colIndices.length} cell values`
        : isFullColumn
          ? 'Copy column values'
          : isSingleCell
            ? 'Copy cell value'
            : `Copy ${rowIndices.length * colIndices.length} cell values`;

    const items: MenuItem[] = [
        { label: copyLabel, onSelect: () => o.copyCells(o.cells!) },
        { label: 'Copy as SQL insert', onSelect: () => o.copyAsSql(rowIndices, colIndices) },
        ...copyColumnNameItem(m, o.columns),
    ];
    // A bigger rectangle/column/everything is copy-only: Set NULL and Delete
    // row stay scoped to a single clicked cell, the same as before this menu
    // recognised anything larger than one.
    if (isSingleCell && o.editable) {
        items.push({
            label: 'Set NULL',
            disabled: o.isDeleted(m.row) || o.isKeyCol(m.col!),
            onSelect: () => o.setNull(m.row, m.col!),
        });
        items.push({
            label: o.isDeleted(m.row) ? 'Keep row' : 'Delete row',
            danger: !o.isDeleted(m.row),
            onSelect: () => o.toggleDelete(m.row),
        });
    }
    return items;
}

/**
 * The grid's right-click menu: opening it, and what it offers for whatever is
 * currently selected -- a row, a column, or a cell/rectangle/everything (all
 * three shapes `cells` can take). Split out of `ResultsTable` purely for
 * length, and further into the module-level `*MenuItems` builders above for
 * the same reason.
 *
 * Three ways in: `openMenu` from a data cell or the row gutter (an existing
 * selection the click lands inside is kept, otherwise a fresh one starts,
 * shaped by the click target); `openColumnMenu` from a header, which always
 * means the column; `openAllMenu` from the corner cell, which always means
 * everything.
 */
export function useGridMenuState(options: Options) {
    const [menu, setMenu] = useState<Menu | null>(null);

    // `row` is 0 for the latter two -- `columnMenuItems` never reads it, and
    // `cellMenuItems`'s single-cell branch (the only other reader) can never
    // apply to a selection these two always leave non-singular.
    const openMenu = (r: number, c: number | null) => (e: React.MouseEvent) => {
        e.preventDefault();
        options.setEditing(null);
        openMenuFor({ r, c }, options);
        setMenu({ row: r, col: c, x: e.clientX, y: e.clientY });
    };
    const openColumnMenu = (c: number) => (e: React.MouseEvent) => {
        e.preventDefault();
        options.setEditing(null);
        openColumnMenuFor(c, options);
        setMenu({ row: 0, col: c, x: e.clientX, y: e.clientY });
    };
    // Not curried like the other two: there is no varying argument to close
    // over, since the corner always means everything.
    const openAllMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        options.setEditing(null);
        selectEverythingFor(options);
        // No one cell to name, the same as the row gutter's `col: null`.
        setMenu({ row: 0, col: null, x: e.clientX, y: e.clientY });
    };

    const menuItems = (m: Menu): MenuItem[] => {
        if (options.selectedCols.size > 0) return columnMenuItems(m, options);
        if (options.cells) return cellMenuItems(m, options);
        return rowMenuItems(m, options);
    };

    return { menu, setMenu, openMenu, openColumnMenu, openAllMenu, menuItems };
}
