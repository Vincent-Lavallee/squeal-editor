import { useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import { CopyIcon, ForeignKeyIcon, NextPageIcon, PrevPageIcon, SortAscIcon, SortDescIcon } from '../../common/icons/icons.ts';
import { useAppSelector } from '../../store/hooks.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';
import { useResults } from './useResults.ts';
import { cancelQuery } from '../../store/resultsSlice.ts';
import Button from '../../common/components/Button.tsx';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import FilterBar from './FilterBar.tsx';
import JsonCellDrawer from './JsonCellDrawer.tsx';
import Note from '../../common/components/Note.tsx';
import Skeleton from '../../common/components/Skeleton.tsx';
import * as t from '../../common/tokens';

/** MySQL's `COLUMN_TYPE` and Postgres' `format_type` both answer bare `json`/`jsonb`
 *  for the type -- see `docs/extension.md`, *Listing a table's columns* -- so a
 *  case-insensitive match on the engine's own string is enough and needs no
 *  per-engine case. SQLite has no JSON type, so this never fires there. */
const isJsonType = (dataType: string | undefined): boolean => {
  if (!dataType) return false;
  const lower = dataType.toLowerCase();
  return lower === 'json' || lower === 'jsonb';
};

const iconSvg = { flex: 'none', width: 16, height: 16 };

/**
 * The sort mark in a header: the arrow in force, or the faint hover hint.
 *
 * One shape for both so the two occupy the *same* slot — the hint is hidden
 * rather than unrendered (see `residual.css`), so a header keeps its width
 * whether it is sorted, hovered or neither, and clicking one never shifts the
 * columns beside it.
 */
const sortMark = (color: string): React.CSSProperties =>
  ({ flex: 'none', width: 14, height: 14, display: 'inline-block', verticalAlign: 'text-bottom', marginLeft: t.GAP_XS, color });

/**
 * What a click on this header will do, named rather than left to be discovered.
 *
 * It says the *next* state, not the current one -- the arrow already shows where
 * the column stands, so a tooltip repeating it would be the second place saying
 * one thing. "Remove sort" is the third step being spelled out, since a cycle
 * whose last click undoes it is the part nobody guesses from two arrows.
 */
const sortTitle = (column: string, sortedBy: 'asc' | 'desc' | null): string =>
  sortedBy === null ? `Sort by ${column}`
    : sortedBy === 'asc' ? `Sort by ${column}, descending`
      : 'Remove sort';

interface Cell { row: number; col: number; }
// `col` is null when the menu was opened from the row gutter rather than a
// cell -- there is no column to target, so column-specific items (Set NULL)
// leave themselves out rather than guessing one.
interface Menu { row: number; col: number | null; x: number; y: number; }

const gridTable: React.CSSProperties = { borderCollapse: 'separate', borderSpacing: 0, fontFamily: t.MONO, fontSize: t.TEXT_BODY, whiteSpace: 'nowrap' };
const cellBase: React.CSSProperties = { height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}`, textAlign: 'left', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' };
const thStyle: React.CSSProperties = { ...cellBase, position: 'sticky', top: 0, zIndex: 1, background: t.BG, color: t.TEXT_MUTED, fontWeight: 600, fontSize: t.TEXT_BADGE };
const gutterStyle: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: t.BG, color: t.TEXT_FAINT, textAlign: 'right', userSelect: 'none', fontSize: t.TEXT_BADGE, height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}` };
const gutterHeadStyle: React.CSSProperties = { ...gutterStyle, zIndex: 2, fontWeight: 600, top: 0 };

export default function ResultsTable() {
  const { result, browse, error, running, startedAt, next, prev, editable, readOnlyReason, missingKeyHint, keyColumns, columnInfo, pending, setCell, clearCell, toggleDelete, discard, save, copyRows, copyRowsAsSql, canCopyAsSql, dirtyCount, saving, saveError, filterActive, clearFilter, navigateForeignKey, sort, toggleSort, canSort } = useResults();
  const activeTabId = useAppSelector(selectActiveTab)?.id ?? null;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<Cell | null>(null);
  const [jsonEditing, setJsonEditing] = useState<Cell | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Set only by a blocked edit attempt (`startEdit` below), never by
  // `missingKeyHint` changing on its own -- an unattempted edit says nothing.
  const [editBlockedHint, setEditBlockedHint] = useState<string | null>(null);
  const editBlockedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelected(new Set()); setSelectedCell(null); setEditing(null); setJsonEditing(null); setMenu(null); anchor.current = null;
    setEditBlockedHint(null);
  }, [result]);

  useEffect(() => () => { if (editBlockedTimeout.current) clearTimeout(editBlockedTimeout.current); }, []);

  useEffect(() => {
    if (!running || !startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const emptyCtr: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, padding: t.GAP_XL, textAlign: 'center' };

  // Above every early return, because a grid tab keeps its filter whatever the
  // grid beneath is showing -- and a rejected filter is exactly the case where
  // the bar has to still be there to be corrected. It draws nothing on an
  // editor tab, so a query's result is unchanged.
  if (running) return (
    <>
      <FilterBar />
      <div data-testid="results-bar" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, flex: 'none', padding: `0 ${t.GAP_LG}px`, height: 32, borderBottom: `1px solid ${t.BORDER}`, fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>
        <ThinkingOrb state="shaping" size={20} theme="dark" aria-label="Running" />
        <span>Running for {elapsed}s…</span>
        {activeTabId && (
          <Button variant="ghost" style={{ height: 24, padding: '0 8px', marginLeft: 'auto' }} onClick={() => cancelQuery(activeTabId)}>
            Cancel
          </Button>
        )}
      </div>
      <GridSkeleton />
    </>
  );
  if (error) return (
    <>
      <FilterBar />
      <div style={emptyCtr}>
        <div data-testid="note-error" style={{ position: 'relative', maxWidth: 560, width: '100%', padding: t.GAP, border: `1px solid ${t.RED}`, borderRadius: t.RADIUS_LG, background: t.RED_BG, color: t.RED_TEXT, fontSize: t.TEXT_BODY, fontFamily: t.MONO, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'left' }}>
          {error}
          <button type="button" style={{ position: 'absolute', top: t.GAP_SM, right: t.GAP_SM, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, border: 'none', borderRadius: t.RADIUS, background: 'transparent', color: t.RED_TEXT, cursor: 'pointer' }}
            onClick={() => void Neutralino.clipboard.writeText(error)} title="Copy error">
            <CopyIcon style={iconSvg} />
          </button>
        </div>
      </div>
    </>
  );
  if (!result) return (
    <>
      <FilterBar />
      <div style={emptyCtr}>
        <div style={{ color: t.TEXT_FAINT, fontSize: t.TEXT_TITLE, fontWeight: 500, marginBottom: t.GAP_XS }}>No results yet</div>
        <Note kind="muted">Run a query to see results.</Note>
      </div>
    </>
  );

  if (result.columns.length === 0) return (
    <>
      <FilterBar />
      <div style={emptyCtr}>
        <div style={{ color: t.GREEN, fontSize: t.TEXT_TITLE, fontWeight: 500, marginBottom: t.GAP_XS }}>Query finished</div>
        <Note kind="ok">{result.message}</Note>
      </div>
    </>
  );

  const count = result.rows.length;
  const firstRow = browse ? browse.offset + 1 : 1;
  const paged = browse !== null && (browse.hasMore || browse.offset > 0);

  const typeByName = new Map(columnInfo.map((c) => [c.name, c.dataType]));
  const typeOf = (col: string): string | undefined => typeByName.get(col);

  // Only a browsed grid's columns ever carry `foreignKey` -- a query's result
  // has no `columnInfo` at all, which is the same boundary editing and "Open
  // definition" already draw around a hand-typed query.
  const fkByName = new Map(columnInfo.filter((c) => c.foreignKey).map((c) => [c.name, c.foreignKey!]));
  const isFkCol = (c: number): boolean => fkByName.has(result.columns[c] ?? '');

  const keyCols = new Set(keyColumns ?? []);
  const isKeyCol = (c: number): boolean => keyCols.has(result.columns[c] ?? '');

  // Auto-detected by type, not by name or content: a JSON/JSONB column edits
  // in the drawer below regardless of what a value happens to look like.
  const isJsonCol = (c: number): boolean => isJsonType(typeOf(result.columns[c] ?? ''));

  const original = (r: number, c: number): CellValue => result.rows[r]?.[c] ?? null;
  const isDeleted = (r: number): boolean => pending.deletes[r] === true;
  const stagedCell = (r: number, c: number): CellValue | undefined => pending.edits[r]?.[c];
  const effective = (r: number, c: number): CellValue => { const s = stagedCell(r, c); return s !== undefined ? s : original(r, c); };

  // Split from the state that closes whichever editor is open, so the JSON
  // drawer's Save/Set NULL can apply the same write without touching `editing`
  // -- the inline `<CellEditor>`'s state, which the drawer never enters.
  const applyEdit = (row: number, col: number, draft: string) => { const orig = original(row, col); if (orig !== null && draft === String(orig)) clearCell(row, col); else setCell(row, col, draft); };
  const applyNull = (row: number, col: number) => { if (isKeyCol(col)) return; if (original(row, col) === null) clearCell(row, col); else setCell(row, col, null); };

  const startEdit = (r: number, c: number) => {
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
  const commit = (row: number, col: number, draft: string) => { applyEdit(row, col, draft); setEditing(null); };
  const setNull = (row: number, col: number) => { applyNull(row, col); setEditing(null); };

  const selectRow = (r: number, e: React.MouseEvent) => {
    setSelectedCell(null);
    if (e.shiftKey && anchor.current !== null) { const [lo, hi] = [Math.min(anchor.current, r), Math.max(anchor.current, r)]; const range = new Set<number>(); for (let i = lo; i <= hi; i++) range.add(i); setSelected(range); }
    else if (e.ctrlKey || e.metaKey) { setSelected((prev) => { const next = new Set(prev); if (next.has(r)) next.delete(r); else next.add(r); return next; }); anchor.current = r; }
    else { setSelected(new Set([r])); anchor.current = r; }
  };

  const selectCell = (r: number, c: number) => {
    setSelected(new Set());
    anchor.current = null;
    setSelectedCell({ row: r, col: c });
  };

  const moveCell = (dr: number, dc: number) => {
    setSelectedCell((cur) => {
      if (!cur) return cur;
      const row = Math.min(Math.max(cur.row + dr, 0), result.rows.length - 1);
      const col = Math.min(Math.max(cur.col + dc, 0), result.columns.length - 1);
      return { row, col };
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (selectedCell) { const value = effective(selectedCell.row, selectedCell.col); void Neutralino.clipboard.writeText(value === null ? '' : String(value)); e.preventDefault(); }
      else if (selected.size > 0) { copyRows([...selected].sort((a, b) => a - b)); e.preventDefault(); }
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && editable && selected.size > 0) { for (const r of selected) if (!isDeleted(r)) toggleDelete(r); e.preventDefault(); }
    else if (selectedCell && e.key === 'ArrowUp') { moveCell(-1, 0); e.preventDefault(); }
    else if (selectedCell && e.key === 'ArrowDown') { moveCell(1, 0); e.preventDefault(); }
    else if (selectedCell && e.key === 'ArrowLeft') { moveCell(0, -1); e.preventDefault(); }
    else if (selectedCell && e.key === 'ArrowRight') { moveCell(0, 1); e.preventDefault(); }
  };

  const openMenu = (r: number, c: number | null) => (e: React.MouseEvent) => {
    e.preventDefault();
    setSelectedCell(null);
    if (!selected.has(r)) { setSelected(new Set([r])); anchor.current = r; }
    setEditing(null); setMenu({ row: r, col: c, x: e.clientX, y: e.clientY });
  };

  const menuItems = (m: Menu): MenuItem[] => {
    const rows = selected.size > 0 ? [...selected].sort((a, b) => a - b) : [m.row];
    const items: MenuItem[] = [{ label: rows.length > 1 ? `Copy ${rows.length} rows` : 'Copy row', onSelect: () => copyRows(rows) }];
    if (canCopyAsSql) items.push({ label: 'Copy as SQL', onSelect: () => copyRowsAsSql(rows) });
    if (editable) {
      if (m.col !== null) items.push({ label: 'Set NULL', disabled: isDeleted(m.row) || isKeyCol(m.col), onSelect: () => setNull(m.row, m.col!) });
      items.push({ label: isDeleted(m.row) ? 'Keep row' : 'Delete row', danger: !isDeleted(m.row), onSelect: () => toggleDelete(m.row) });
    }
    return items;
  };

  const barH = 32;

  return (
    <>
      <FilterBar />
      <div data-testid="results-bar" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, flex: 'none', padding: `0 ${t.GAP_LG}px`, height: barH, borderBottom: `1px solid ${t.BORDER}`, fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>
        {/* No table name: the tab and the filter bar above both already say
            which table this is, and one place names a thing. */}
        <span>
          {browse ? `rows ${firstRow}–${browse.offset + count}` : `${count} row${count === 1 ? '' : 's'}`} · {result.durationMs} ms
          {/* `readOnlyReason` is a standing fact about the connection or the
              table, shown unprompted; `editBlockedHint` is the opposite -- it
              exists only because a double-click just asked, and it goes away
              on its own, see `startEdit`. The two never apply at once. */}
          {(readOnlyReason || editBlockedHint) && (
            <span data-testid="results-ro" style={{ color: t.TEXT_FAINT }}> · {readOnlyReason ?? editBlockedHint}</span>
          )}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, marginLeft: 'auto' }}>
          {/* Clear lives here rather than in the filter bar because it is a fact
              about the result on screen, and because it is the one filter control
              that is not needed to recover from a filter the server refused. */}
          {filterActive && (
            <Button variant="ghost" data-testid="filter-clear" style={{ height: 24, padding: '0 8px' }} onClick={clearFilter}>
              Clear filter
            </Button>
          )}

          {paged && browse && (
            <div data-testid="results-pager" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS }}>
              <Button variant="ghost" style={{ height: 24, padding: '0 6px' }} onClick={prev} disabled={browse.offset === 0} title="Previous page">
                <PrevPageIcon style={iconSvg} aria-hidden="true" /> Prev
              </Button>
              <Button variant="ghost" style={{ height: 24, padding: '0 6px' }} onClick={next} disabled={!browse.hasMore} title="Next page">
                Next <NextPageIcon style={iconSvg} aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {(dirtyCount > 0 || saving || saveError) && (
        <div data-testid="results-savebar" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, flex: 'none', padding: `0 ${t.GAP_LG}px`, height: 34, borderBottom: `1px solid ${t.BORDER}`, fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>
          <span style={saveError ? { color: t.RED_TEXT } : undefined}>{saveError ?? `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}</span>
          <div data-testid="results-save-actions" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, marginLeft: 'auto' }}>
            <Button variant="ghost" style={{ height: 24, padding: '0 10px' }} onClick={discard} disabled={saving}>Discard</Button>
            <Button variant="primary" style={{ height: 24, padding: '0 10px' }} onClick={() => void save()} disabled={saving || dirtyCount === 0}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}

      <div data-testid="grid-scroll" style={{ flex: 1, overflow: 'auto', minHeight: 0 }} tabIndex={0} onKeyDown={onKeyDown}>
        <table className="grid" style={gridTable}>
          <thead>
            <tr>
              <th className="gutter" style={gutterHeadStyle} />
              {result.columns.map((col, i) => {
                const sortable = canSort(col);
                const sortedBy = sort?.column === col ? sort.direction : null;
                const SortIcon = sortedBy === 'desc' ? SortDescIcon : SortAscIcon;
                return (
                  <th key={i} data-testid="grid-col" data-sort={sortedBy ?? undefined}
                    className={sortable ? 'grid__th--sortable' : undefined}
                    style={{ ...thStyle, ...(sortable ? { cursor: 'pointer', userSelect: 'none' } : {}) }}
                    // The whole header is the target rather than a button inside
                    // it: the name and the type are one label for one column, so
                    // a click anywhere along it means the same thing. The grid's
                    // cells and its row gutter are already click targets without
                    // a button each, and a button here would have to re-state the
                    // sticky positioning and the borders the cell already carries.
                    onClick={sortable ? () => toggleSort(col) : undefined}
                    title={sortable ? sortTitle(col, sortedBy) : undefined}>
                    <span data-testid="grid-col-name">{col}</span>
                    {typeOf(col) && <span style={{ marginLeft: t.GAP_SM, fontWeight: 400, color: t.TEXT_FAINT }}>{typeOf(col)}</span>}
                    {/* The sorted column draws its arrow in accent, always. Any
                        other sortable one draws a faint ascending chevron that
                        `residual.css` reveals on hover -- it previews what the
                        click will do rather than merely announcing that sorting
                        exists, which is why it is the ascending glyph and not a
                        neutral one. The hovered column is the only one showing
                        it, so this is not the arrow-on-every-header the design
                        avoids; it is the hover cue, drawn. */}
                    {sortedBy ? (
                      <SortIcon data-testid="grid-sort-arrow" style={sortMark(t.ACCENT)} aria-hidden="true" />
                    ) : sortable ? (
                      <SortAscIcon className="grid__sort-hint" data-testid="grid-sort-hint" style={sortMark(t.TEXT_FAINT)} aria-hidden="true" />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, r) => {
              const deleted = isDeleted(r);
              const sel = selected.has(r);
              const rowCls = deleted ? 'grid__row--deleted' : sel ? 'grid__row--selected' : '';
              return (
                <tr key={r} className={rowCls}>
                  <td className="gutter" style={{ ...gutterStyle, ...(sel ? { cursor: 'pointer' } : {}) }}
                    onClick={(e) => selectRow(r, e)} onContextMenu={openMenu(r, null)} title="Click to select the row">{firstRow + r}</td>
                  {row.map((_cell, c) => {
                    const isEditing = editing?.row === r && editing.col === c;
                    const isCellSelected = selectedCell?.row === r && selectedCell.col === c;
                    const value = effective(r, c);
                    const dirty = stagedCell(r, c) !== undefined;
                    const cellCls = [
                      isEditing && 'grid__cell--editing',
                      isCellSelected && 'grid__cell--selected',
                      dirty && 'grid__cell--dirty',
                    ].filter(Boolean).join(' ') || undefined;
                    return (
                      <td key={c} className={cellCls} style={cellBase}
                        onClick={() => !isEditing && selectCell(r, c)}
                        onDoubleClick={() => startEdit(r, c)} onContextMenu={openMenu(r, c)}>
                        {isEditing ? (
                          <CellEditor initial={value} canNull={!isKeyCol(c)}
                            onCommit={(draft) => commit(r, c, draft)} onNull={() => setNull(r, c)} onCancel={() => setEditing(null)} />
                        ) : value === null ? (
                          <span data-testid="null-value" style={{ color: t.TEXT_FAINT, fontStyle: 'italic' }}>NULL</span>
                        ) : isFkCol(c) ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: t.GAP_XS }}>
                            {String(value)}
                            <button type="button" data-testid="fk-nav" title={`Open the row ${result.columns[c]} points at`}
                              style={{ flex: 'none', display: 'inline-flex', padding: 0, border: 'none', background: 'transparent', color: t.TEXT_FAINT, cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); navigateForeignKey(result.columns[c]!, value); }}>
                              <ForeignKeyIcon style={{ flex: 'none', width: 14, height: 14 }} aria-hidden="true" />
                            </button>
                          </span>
                        ) : (String(value))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}

      {jsonEditing && (
        <JsonCellDrawer
          column={result.columns[jsonEditing.col] ?? ''}
          dataType={typeOf(result.columns[jsonEditing.col] ?? '')}
          initial={effective(jsonEditing.row, jsonEditing.col)}
          canNull={!isKeyCol(jsonEditing.col)}
          onCommit={(draft) => { applyEdit(jsonEditing.row, jsonEditing.col, draft); setJsonEditing(null); }}
          onNull={() => { applyNull(jsonEditing.row, jsonEditing.col); setJsonEditing(null); }}
          onCancel={() => setJsonEditing(null)}
        />
      )}
    </>
  );
}

function CellEditor({ initial, canNull, onCommit, onNull, onCancel }: {
  initial: CellValue; canNull: boolean; onCommit: (draft: string) => void; onNull: () => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial === null ? '' : String(initial));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, width: '100%' }}>
      <input ref={ref} data-testid="cell-edit-input" style={{ flex: 1, minWidth: 0, padding: 0, border: 'none', outline: 'none', background: 'transparent', color: t.TEXT, fontFamily: t.MONO, fontSize: t.TEXT_BODY, caretColor: t.ACCENT }}
        value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit(draft); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          else if (canNull && (e.ctrlKey || e.metaKey) && e.key === 'Delete') { e.preventDefault(); onNull(); }
        }} />
      {canNull && (
        <button type="button" data-testid="cell-edit-null" style={{ flex: 'none', padding: '0 2px', border: 'none', background: 'transparent', color: t.TEXT_FAINT, fontSize: t.TEXT_BODY, cursor: 'pointer' }}
          title="Set NULL (Ctrl+Delete)"
          onMouseDown={(e) => { e.preventDefault(); onNull(); }}>∅</button>
      )}
    </span>
  );
}

const COL_WIDTHS = [120, 180, 140, 100];

function GridSkeleton() {
  const barH = 32;
  const rows = 10;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, flex: 'none', padding: `0 ${t.GAP_LG}px`, height: barH, borderBottom: `1px solid ${t.BORDER}`, fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>
        <Skeleton width={100} height={12} />
        <Skeleton width={60} height={12} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <table className="grid" style={{ borderCollapse: 'separate', borderSpacing: 0, fontFamily: t.MONO, fontSize: t.TEXT_BODY, whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th className="gutter" style={{ position: 'sticky', left: 0, zIndex: 2, background: t.BG, color: t.TEXT_FAINT, textAlign: 'right', userSelect: 'none', fontSize: t.TEXT_BADGE, height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}`, top: 0 }}>
                <Skeleton width={28} height={12} style={{ marginLeft: 'auto' }} />
              </th>
              {COL_WIDTHS.map((w, i) => (
                <th key={i} style={{ position: 'sticky', top: 0, zIndex: 1, background: t.BG, height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}`, textAlign: 'left' }}>
                  <Skeleton width={w * 0.7} height={12} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                <td className="gutter" style={{ position: 'sticky', left: 0, zIndex: 1, background: t.BG, color: t.TEXT_FAINT, textAlign: 'right', userSelect: 'none', fontSize: t.TEXT_BADGE, height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}` }}>
                  <Skeleton width={28} height={12} style={{ marginLeft: 'auto' }} />
                </td>
                {COL_WIDTHS.map((w, c) => (
                  <td key={c} style={{ height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}`, textAlign: 'left', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Skeleton width={w * (0.5 + ((r * 3 + c) % 7) * 0.07)} height={12} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
