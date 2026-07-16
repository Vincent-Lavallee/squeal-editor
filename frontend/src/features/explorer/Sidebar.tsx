import type { TableInfo } from '../../../../shared/protocol.ts';
import { TableIcon, ViewIcon } from '../../icons.ts';
import { useExplorer } from './useExplorer.ts';

interface Props {
  /** Opening a table spans three features, so the shell decides what it means. */
  onSelectTable: (database: string, table: TableInfo) => void;
  /** So does pointing a tab at another database -- and what that means depends on the tab. */
  onSelectDatabase: (database: string) => void;
}

export default function Sidebar({ onSelectTable, onSelectDatabase }: Props) {
  const { databases, database, hasTab, tables, loading, error } = useExplorer();

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
        {tables?.length === 0 && <div className="tree__note">No tables</div>}

        {database &&
          tables?.map((t) => (
            <button
              key={t.name}
              className="tree__row"
              onClick={() => onSelectTable(database, t)}
              title={`${t.name} — click to browse`}
            >
              {t.kind === 'view' ? (
                <ViewIcon className="icon tree__icon" aria-hidden="true" />
              ) : (
                <TableIcon className="icon tree__icon" aria-hidden="true" />
              )}
              <span className="tree__label">{t.name}</span>
            </button>
          ))}
      </nav>
    </aside>
  );
}
