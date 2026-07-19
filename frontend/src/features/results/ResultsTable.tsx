import { useEffect, useRef, useState } from 'react';

import type { CellValue } from '../../../../shared/protocol.ts';
import { NextPageIcon, PrevPageIcon } from '../../icons.ts';
import CellContextMenu, { type CellMenuItem } from './CellContextMenu.tsx';
import { useResults } from './useResults.ts';

/** Which cell is being edited, and the menu's summon point. */
interface Cell {
  row: number;
  col: number;
}
interface Menu extends Cell {
  x: number;
  y: number;
}

export default function ResultsTable() {
  const {
    result,
    browse,
    error,
    running,
    next,
    prev,
    editable,
    readOnlyReason,
    keyColumns,
    columnInfo,
    pending,
    setCell,
    clearCell,
    toggleDelete,
    discard,
    save,
    copyRows,
    dirtyCount,
    saving,
    saveError,
  } = useResults();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const [editing, setEditing] = useState<Cell | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  // The grid content changed -- a new page, a re-browse after save, or a tab
  // switch -- so selection, the open editor and the menu all belonged to rows
  // that are no longer these rows. Keyed on the result object, which is a fresh
  // reference on every one of those; staging a cell does not touch it.
  useEffect(() => {
    setSelected(new Set());
    setEditing(null);
    setMenu(null);
    anchor.current = null;
  }, [result]);

  if (running) return <div className="note note--muted">Running…</div>;
  if (error) return <div className="note note--error">{error}</div>;
  if (!result) return <div className="note note--muted">Run a query to see results.</div>;

  // Statements like INSERT/UPDATE come back with no column set, just a count.
  if (result.columns.length === 0) {
    return <div className="note note--ok">{result.message}</div>;
  }

  const count = result.rows.length;
  // Rows are numbered from where the page starts, not from 1: on page 2 a gutter
  // counting 1..100 again would name two different rows the same thing.
  const firstRow = browse ? browse.offset + 1 : 1;
  // A table that fits on one page has nowhere to go, and two dead buttons say
  // "there is paging here" about the one case where there is not.
  const paged = browse !== null && (browse.hasMore || browse.offset > 0);

  // The type shown beside each column name, looked up by name so a mismatch in
  // count or order between the page and the catalog cannot misalign it.
  const typeByName = new Map(columnInfo.map((c) => [c.name, c.dataType]));
  const typeOf = (col: string): string | undefined => typeByName.get(col);

  // A key column identifies the row: setting it NULL would break the row's
  // identity (and a primary key forbids NULL outright), so NULL is refused there.
  const keyCols = new Set(keyColumns ?? []);
  const isKeyCol = (c: number): boolean => keyCols.has(result.columns[c] ?? '');

  const original = (r: number, c: number): CellValue => result.rows[r]?.[c] ?? null;
  const isDeleted = (r: number): boolean => pending.deletes[r] === true;
  const stagedCell = (r: number, c: number): CellValue | undefined => pending.edits[r]?.[c];
  const effective = (r: number, c: number): CellValue => {
    const staged = stagedCell(r, c);
    return staged !== undefined ? staged : original(r, c);
  };

  const startEdit = (r: number, c: number) => {
    if (!editable || isDeleted(r)) return;
    setEditing({ row: r, col: c });
  };

  // Commit the typed text. Back to exactly the original clears the stage rather
  // than recording a no-op edit; anything else stages the text as-is -- including
  // the empty string, which is deliberately distinct from NULL.
  const commit = (row: number, col: number, draft: string) => {
    const orig = original(row, col);
    if (orig !== null && draft === String(orig)) clearCell(row, col);
    else setCell(row, col, draft);
    setEditing(null);
  };
  const setNull = (row: number, col: number) => {
    // A key column has no NULL to be set to -- it identifies the row.
    if (isKeyCol(col)) return;
    // A cell that was already NULL has no change to stage.
    if (original(row, col) === null) clearCell(row, col);
    else setCell(row, col, null);
    setEditing(null);
  };

  const selectRow = (r: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current !== null) {
      const [lo, hi] = [Math.min(anchor.current, r), Math.max(anchor.current, r)];
      const range = new Set<number>();
      for (let i = lo; i <= hi; i++) range.add(i);
      setSelected(range);
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const nextSel = new Set(prev);
        if (nextSel.has(r)) nextSel.delete(r);
        else nextSel.add(r);
        return nextSel;
      });
      anchor.current = r;
    } else {
      setSelected(new Set([r]));
      anchor.current = r;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // While a cell editor is open its own input owns the keys.
    if (editing) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (selected.size > 0) {
        copyRows([...selected].sort((a, b) => a - b));
        e.preventDefault();
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable && selected.size > 0) {
      // Delete marks the selected rows for deletion (it does not un-mark);
      // toggling back off is the row menu's Undelete.
      for (const r of selected) if (!isDeleted(r)) toggleDelete(r);
      e.preventDefault();
    }
  };

  const openMenu = (r: number, c: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    // Right-clicking a row outside the selection makes it the selection, so Copy
    // and the count act on what was clicked.
    if (!selected.has(r)) {
      setSelected(new Set([r]));
      anchor.current = r;
    }
    setEditing(null);
    setMenu({ row: r, col: c, x: e.clientX, y: e.clientY });
  };

  const menuItems = (m: Menu): CellMenuItem[] => {
    const rows = selected.size > 0 ? [...selected].sort((a, b) => a - b) : [m.row];
    const items: CellMenuItem[] = [
      { label: rows.length > 1 ? `Copy ${rows.length} rows` : 'Copy row', onSelect: () => copyRows(rows) },
    ];
    if (editable) {
      items.push({
        label: 'Set NULL',
        // A key column has no NULL to be set to -- it identifies the row.
        disabled: isDeleted(m.row) || isKeyCol(m.col),
        onSelect: () => setNull(m.row, m.col),
      });
      items.push({
        label: isDeleted(m.row) ? 'Keep row' : 'Delete row',
        danger: !isDeleted(m.row),
        onSelect: () => toggleDelete(m.row),
      });
    }
    return items;
  };

  return (
    <>
      <div className="results__bar">
        <span>
          {browse
            ? `${browse.table} · rows ${firstRow}–${browse.offset + count}`
            : `${count} row${count === 1 ? '' : 's'}`}{' '}
          · {result.durationMs} ms
          {readOnlyReason && <span className="results__ro"> · {readOnlyReason}</span>}
        </span>

        {paged && browse && (
          <div className="results__pager">
            <button
              className="btn btn--ghost"
              onClick={prev}
              disabled={browse.offset === 0}
              title="Previous page"
            >
              <PrevPageIcon className="icon" aria-hidden="true" />
              Prev
            </button>
            <button className="btn btn--ghost" onClick={next} disabled={!browse.hasMore} title="Next page">
              Next
              <NextPageIcon className="icon" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {(dirtyCount > 0 || saving || saveError) && (
        <div className="results__savebar">
          <span className={saveError ? 'results__saveerr' : ''}>
            {saveError ?? `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}
          </span>
          <div className="results__saveactions">
            <button className="btn btn--ghost" onClick={discard} disabled={saving}>
              Discard
            </button>
            <button className="btn btn--primary" onClick={() => void save()} disabled={saving || dirtyCount === 0}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="grid-scroll" tabIndex={0} onKeyDown={onKeyDown}>
        <table className="grid">
          <thead>
            <tr>
              <th className="gutter" />
              {result.columns.map((col, i) => (
                <th key={i}>
                  <span className="grid__col-name">{col}</span>
                  {typeOf(col) && <span className="grid__col-type">{typeOf(col)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, r) => (
              <tr key={r} className={isDeleted(r) ? 'grid__row--deleted' : selected.has(r) ? 'grid__row--selected' : ''}>
                <td
                  className="gutter gutter--select"
                  onClick={(e) => selectRow(r, e)}
                  title="Click to select the row"
                >
                  {firstRow + r}
                </td>
                {row.map((_cell, c) => {
                  const isEditing = editing?.row === r && editing.col === c;
                  const value = effective(r, c);
                  const dirty = stagedCell(r, c) !== undefined;
                  const cls = isEditing ? 'grid__cell--editing' : dirty ? 'grid__cell--dirty' : undefined;
                  return (
                    <td
                      key={c}
                      className={cls}
                      onDoubleClick={() => startEdit(r, c)}
                      onContextMenu={openMenu(r, c)}
                    >
                      {isEditing ? (
                        <CellEditor
                          initial={value}
                          // A key column cannot be NULLed, so it gets no ∅ button.
                          canNull={!isKeyCol(c)}
                          onCommit={(draft) => commit(r, c, draft)}
                          onNull={() => setNull(r, c)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : value === null ? (
                        <span className="null">NULL</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {menu && <CellContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
    </>
  );
}

/**
 * The in-place cell editor. A NULL value starts as an empty box; committing that
 * empty box is the empty string, and NULL is reached explicitly -- Ctrl+Delete or
 * the ∅ button -- which is the whole point of keeping the two apart. `canNull` is
 * false for a key column, which has no NULL to be set to, so it offers neither.
 */
function CellEditor({
  initial,
  canNull,
  onCommit,
  onNull,
  onCancel,
}: {
  initial: CellValue;
  canNull: boolean;
  onCommit: (draft: string) => void;
  onNull: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial === null ? '' : String(initial));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <span className="cell-edit">
      <input
        ref={ref}
        className="cell-edit__input mono"
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
          className="cell-edit__null"
          title="Set NULL (Ctrl+Delete)"
          // Down, not click: a click blurs the input first, whose onBlur would
          // commit the text before the button's handler runs.
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
