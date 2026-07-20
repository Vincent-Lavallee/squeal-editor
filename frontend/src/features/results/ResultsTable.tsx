import { useEffect, useRef, useState } from 'react';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import { CopyIcon, NextPageIcon, PrevPageIcon } from '../../common/icons/icons.ts';
import { useResults } from './useResults.ts';
import Button from '../../common/components/Button.tsx';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import Note from '../../common/components/Note.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Cell { row: number; col: number; }
interface Menu extends Cell { x: number; y: number; }

const gridTable: React.CSSProperties = { borderCollapse: 'separate', borderSpacing: 0, fontFamily: t.MONO, fontSize: t.TEXT_BODY, whiteSpace: 'nowrap' };
const cellBase: React.CSSProperties = { height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}`, textAlign: 'left', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' };
const thStyle: React.CSSProperties = { ...cellBase, position: 'sticky', top: 0, zIndex: 1, background: t.BG, color: t.TEXT_MUTED, fontWeight: 600, fontSize: t.TEXT_BADGE };
const gutterStyle: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: t.BG, color: t.TEXT_FAINT, textAlign: 'right', userSelect: 'none', fontSize: t.TEXT_BADGE, height: t.ROW_H_DENSE, padding: '0 10px', borderRight: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}` };
const gutterHeadStyle: React.CSSProperties = { ...gutterStyle, zIndex: 2, fontWeight: 600, top: 0 };

export default function ResultsTable() {
  const { result, browse, error, running, next, prev, editable, readOnlyReason, keyColumns, columnInfo, pending, setCell, clearCell, toggleDelete, discard, save, copyRows, dirtyCount, saving, saveError } = useResults();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const [editing, setEditing] = useState<Cell | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => { setSelected(new Set()); setEditing(null); setMenu(null); anchor.current = null; }, [result]);

  const emptyCtr: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, padding: t.GAP_XL, textAlign: 'center' };

  if (running) return <div style={emptyCtr}><Note kind="muted">Running…</Note></div>;
  if (error) return (
    <div style={emptyCtr}>
      <div data-testid="note-error" style={{ position: 'relative', maxWidth: 560, width: '100%', padding: t.GAP, border: `1px solid ${t.RED}`, borderRadius: t.RADIUS_LG, background: t.RED_BG, color: t.RED_TEXT, fontSize: t.TEXT_BODY, fontFamily: t.MONO, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'left' }}>
        {error}
        <button type="button" style={{ position: 'absolute', top: t.GAP_SM, right: t.GAP_SM, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, border: 'none', borderRadius: t.RADIUS, background: 'transparent', color: t.RED_TEXT, cursor: 'pointer' }}
          onClick={() => void Neutralino.clipboard.writeText(error)} title="Copy error">
          <CopyIcon style={iconSvg} />
        </button>
      </div>
    </div>
  );
  if (!result) return (
    <div style={emptyCtr}>
      <div style={{ color: t.TEXT_FAINT, fontSize: t.TEXT_TITLE, fontWeight: 500, marginBottom: t.GAP_XS }}>No results yet</div>
      <Note kind="muted">Run a query to see results.</Note>
    </div>
  );

  if (result.columns.length === 0) return (
    <div style={emptyCtr}>
      <div style={{ color: t.GREEN, fontSize: t.TEXT_TITLE, fontWeight: 500, marginBottom: t.GAP_XS }}>Query finished</div>
      <Note kind="ok">{result.message}</Note>
    </div>
  );

  const count = result.rows.length;
  const firstRow = browse ? browse.offset + 1 : 1;
  const paged = browse !== null && (browse.hasMore || browse.offset > 0);

  const typeByName = new Map(columnInfo.map((c) => [c.name, c.dataType]));
  const typeOf = (col: string): string | undefined => typeByName.get(col);

  const keyCols = new Set(keyColumns ?? []);
  const isKeyCol = (c: number): boolean => keyCols.has(result.columns[c] ?? '');

  const original = (r: number, c: number): CellValue => result.rows[r]?.[c] ?? null;
  const isDeleted = (r: number): boolean => pending.deletes[r] === true;
  const stagedCell = (r: number, c: number): CellValue | undefined => pending.edits[r]?.[c];
  const effective = (r: number, c: number): CellValue => { const s = stagedCell(r, c); return s !== undefined ? s : original(r, c); };

  const startEdit = (r: number, c: number) => { if (!editable || isDeleted(r)) return; setEditing({ row: r, col: c }); };
  const commit = (row: number, col: number, draft: string) => { const orig = original(row, col); if (orig !== null && draft === String(orig)) clearCell(row, col); else setCell(row, col, draft); setEditing(null); };
  const setNull = (row: number, col: number) => { if (isKeyCol(col)) return; if (original(row, col) === null) clearCell(row, col); else setCell(row, col, null); setEditing(null); };

  const selectRow = (r: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current !== null) { const [lo, hi] = [Math.min(anchor.current, r), Math.max(anchor.current, r)]; const range = new Set<number>(); for (let i = lo; i <= hi; i++) range.add(i); setSelected(range); }
    else if (e.ctrlKey || e.metaKey) { setSelected((prev) => { const next = new Set(prev); if (next.has(r)) next.delete(r); else next.add(r); return next; }); anchor.current = r; }
    else { setSelected(new Set([r])); anchor.current = r; }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { if (selected.size > 0) { copyRows([...selected].sort((a, b) => a - b)); e.preventDefault(); } }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && editable && selected.size > 0) { for (const r of selected) if (!isDeleted(r)) toggleDelete(r); e.preventDefault(); }
  };

  const openMenu = (r: number, c: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (!selected.has(r)) { setSelected(new Set([r])); anchor.current = r; }
    setEditing(null); setMenu({ row: r, col: c, x: e.clientX, y: e.clientY });
  };

  const menuItems = (m: Menu): MenuItem[] => {
    const rows = selected.size > 0 ? [...selected].sort((a, b) => a - b) : [m.row];
    const items: MenuItem[] = [{ label: rows.length > 1 ? `Copy ${rows.length} rows` : 'Copy row', onSelect: () => copyRows(rows) }];
    if (editable) {
      items.push({ label: 'Set NULL', disabled: isDeleted(m.row) || isKeyCol(m.col), onSelect: () => setNull(m.row, m.col) });
      items.push({ label: isDeleted(m.row) ? 'Keep row' : 'Delete row', danger: !isDeleted(m.row), onSelect: () => toggleDelete(m.row) });
    }
    return items;
  };

  const barH = 32;

  return (
    <>
      <div data-testid="results-bar" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, flex: 'none', padding: `0 ${t.GAP_LG}px`, height: barH, borderBottom: `1px solid ${t.BORDER}`, fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>
        <span>
          {browse ? `${browse.table} · rows ${firstRow}–${browse.offset + count}` : `${count} row${count === 1 ? '' : 's'}`} · {result.durationMs} ms
          {readOnlyReason && <span data-testid="results-ro" style={{ color: t.TEXT_FAINT }}> · {readOnlyReason}</span>}
        </span>

        {paged && browse && (
          <div data-testid="results-pager" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, marginLeft: 'auto' }}>
            <Button variant="ghost" style={{ height: 24, padding: '0 6px' }} onClick={prev} disabled={browse.offset === 0} title="Previous page">
              <PrevPageIcon style={iconSvg} aria-hidden="true" /> Prev
            </Button>
            <Button variant="ghost" style={{ height: 24, padding: '0 6px' }} onClick={next} disabled={!browse.hasMore} title="Next page">
              Next <NextPageIcon style={iconSvg} aria-hidden="true" />
            </Button>
          </div>
        )}
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
              {result.columns.map((col, i) => (
                <th key={i} style={thStyle}>
                  <span data-testid="grid-col-name">{col}</span>
                  {typeOf(col) && <span style={{ marginLeft: t.GAP_SM, fontWeight: 400, color: t.TEXT_FAINT }}>{typeOf(col)}</span>}
                </th>
              ))}
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
                    onClick={(e) => selectRow(r, e)} title="Click to select the row">{firstRow + r}</td>
                  {row.map((_cell, c) => {
                    const isEditing = editing?.row === r && editing.col === c;
                    const value = effective(r, c);
                    const dirty = stagedCell(r, c) !== undefined;
                    const cellCls = isEditing ? 'grid__cell--editing' : dirty ? 'grid__cell--dirty' : undefined;
                    return (
                      <td key={c} className={cellCls} style={cellBase}
                        onDoubleClick={() => startEdit(r, c)} onContextMenu={openMenu(r, c)}>
                        {isEditing ? (
                          <CellEditor initial={value} canNull={!isKeyCol(c)}
                            onCommit={(draft) => commit(r, c, draft)} onNull={() => setNull(r, c)} onCancel={() => setEditing(null)} />
                        ) : value === null ? (
                          <span data-testid="null-value" style={{ color: t.TEXT_FAINT, fontStyle: 'italic' }}>NULL</span>
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
