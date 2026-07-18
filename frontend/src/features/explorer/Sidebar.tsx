import { useMemo, useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol.ts';
import { DisclosureIcon, KeyIcon, TableIcon, ViewIcon } from '../../icons.ts';
import DropTableConfirm from './DropTableConfirm.tsx';
import TableContextMenu from './TableContextMenu.tsx';
import { useExplorer } from './useExplorer.ts';

interface Props {
  /** Opening a table spans three features, so the shell decides what it means. */
  onSelectTable: (database: string, table: TableInfo) => void;
  /** So does pointing a tab at another database -- and what that means depends on the tab. */
  onSelectDatabase: (database: string) => void;
  /** Its definition opens in a new editor tab, which spans the bridge, tabs and editor. */
  onShowDefinition: (database: string, table: TableInfo) => void;
}

export default function Sidebar({ onSelectTable, onSelectDatabase, onShowDefinition }: Props) {
  const { databases, database, hasTab, tables, columnsFor, loadTableColumns, dropTable, readOnly, loading, error } =
    useExplorer();

  // Which rows are open. Webview-only UI state -- it never crossed the bridge --
  // so it lives here rather than in a slice. Keyed by table name, which is all a
  // tree of one database ever shows at once.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  // The context menu (a table plus where it was summoned) and the drop it may
  // lead to. Both are webview-only, so both live here rather than in a slice.
  const [menu, setMenu] = useState<{ table: TableInfo; x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState<TableInfo | null>(null);

  // Copy is a plain webview clipboard write -- it never crosses the bridge, the
  // same as the window chrome calls, so it does not go through the explorer's
  // hook or a thunk.
  const copyName = (name: string) => void Neutralino.clipboard.writeText(name);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else {
        next.add(name);
        // Fetch on open; the thunk's condition dedupes, so an already-completed
        // table costs nothing and a re-open never re-hits the bridge.
        if (database) loadTableColumns(database, name);
      }
      return next;
    });
  };

  // Tables above views. A stable sort keeps the server's within-group order (by
  // name) -- no heading, since the view icon already tells the two kinds apart.
  const sorted = useMemo(
    () => (tables ? [...tables].sort((a, b) => (a.kind === 'view' ? 1 : 0) - (b.kind === 'view' ? 1 : 0)) : tables),
    [tables]
  );

  return (
    <aside className="sidebar">
      {/*
        Which server this is belongs to the window, not to the tree, so the
        titlebar carries it -- printing it twice is how the two drift apart. The
        database is the tree's own business, and this is the one place naming it.

        A native select rather than a menu of our own: it brings the platform's
        keyboard handling and typeahead with it, which is the same trade the
        engine picker on the connect form already makes.
      */}
      <div className="sidebar__head">
        <select
          className="select"
          value={database ?? ''}
          onChange={(e) => onSelectDatabase(e.target.value)}
          // Only when there is genuinely nothing to pick, or no tab to point.
          // Not `database === null`: a tab whose database is null is exactly the
          // case that needs the picker most, and disabling it there is what left
          // the empty state with no way out but reconnecting.
          disabled={!hasTab || databases.length === 0}
          aria-label="Database"
        >
          {/* A tab can point at nothing -- no tabs are open, or the server has no
              databases. Say so, rather than letting the select fall back to
              displaying the first option and name a database nothing is on. */}
          {database === null && (
            <option value="" disabled>
              {databases.length === 0 ? 'No databases' : 'Select a database…'}
            </option>
          )}
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
      </div>

      <nav className="tree">
        {loading && <div className="tree__note">Loading…</div>}
        {/* An error renders where its action was taken: listing tables failed, so
            it belongs in the tree, not in a pane about query results. */}
        {error && <div className="tree__note tree__note--error">{error}</div>}
        {sorted?.length === 0 && <div className="tree__note">No tables</div>}

        {database &&
          sorted?.map((t) => {
            const open = expanded.has(t.name);
            return (
              <div key={t.name} className="tree__item">
                <div
                  className="tree__row"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ table: t, x: e.clientX, y: e.clientY });
                  }}
                >
                  {/* The chevron toggles the columns; the name still browses. Two
                      buttons because one cannot nest in the other -- the tab
                      strip's structure exactly. */}
                  <button
                    className="tree__toggle"
                    onClick={() => toggle(t.name)}
                    aria-expanded={open}
                    aria-label={open ? `Collapse ${t.name}` : `Expand ${t.name}`}
                  >
                    <DisclosureIcon
                      className={`icon tree__chevron${open ? ' tree__chevron--open' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  <button className="tree__name" onClick={() => onSelectTable(database, t)} title={`${t.name} — click to browse`}>
                    {t.kind === 'view' ? (
                      <ViewIcon className="icon tree__icon" aria-hidden="true" />
                    ) : (
                      <TableIcon className="icon tree__icon" aria-hidden="true" />
                    )}
                    <span className="tree__label">{t.name}</span>
                  </button>
                </div>

                {open && <Columns columns={columnsFor(database, t.name)} />}
              </div>
            );
          })}
      </nav>

      {menu && database && (
        <TableContextMenu
          table={menu.table}
          x={menu.x}
          y={menu.y}
          readOnly={readOnly}
          onCopyName={() => copyName(menu.table.name)}
          onShowDefinition={() => onShowDefinition(database, menu.table)}
          onDrop={() => setDropping(menu.table)}
          onClose={() => setMenu(null)}
        />
      )}

      {dropping && database && (
        <DropTableConfirm
          table={dropping}
          onConfirm={async () => {
            await dropTable(database, dropping.name, dropping.kind);
            setDropping(null);
          }}
          onCancel={() => setDropping(null)}
        />
      )}
    </aside>
  );
}

/**
 * The columns revealed under an expanded row. The three states are the cache's
 * own: `undefined`/`null` is still loading (or a fetch that failed, which the
 * completion also leaves silent), an array is the answer. A key mark on the
 * primary key, muted like every tree glyph -- shape, not colour.
 */
function Columns({ columns }: { columns: ReturnType<ReturnType<typeof useExplorer>['columnsFor']> }) {
  if (columns == null) return <div className="tree__note tree__note--nested">Loading…</div>;
  if (columns.length === 0) return <div className="tree__note tree__note--nested">No columns</div>;

  return (
    <ul className="tree__columns">
      {columns.map((c) => (
        <li key={c.name} className="tree__col" title={`${c.name} ${c.dataType}${c.primaryKey ? ' · primary key' : ''}`}>
          <span className="tree__col-name mono">{c.name}</span>
          {c.primaryKey && <KeyIcon className="icon tree__key" aria-label="primary key" />}
          <span className="tree__col-type">{c.dataType}</span>
        </li>
      ))}
    </ul>
  );
}
