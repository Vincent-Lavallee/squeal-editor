import type { TableInfo } from '../../../../shared/protocol.ts';
import { useExplorer } from './useExplorer.ts';

interface Props {
  /** Opening a table spans three features, so the shell decides what it means. */
  onSelectTable: (database: string, table: TableInfo) => void;
}

export default function Sidebar({ onSelectTable }: Props) {
  const { databases, tables, loadingTables, error, activeDatabase, expanded, selectDatabase } =
    useExplorer();

  return (
    <aside className="sidebar">
      {/*
        Which server this is belongs to the window, not to the tree, so the
        titlebar carries it -- printing it twice is how the two drift apart.
        What is left is the tree's own header.
      */}
      <div className="sidebar__head">
        <span className="label">Databases</span>
      </div>

      <nav className="tree">
        {databases.map((db) => {
          const isExpanded = expanded === db;
          const dbTables = tables[db];
          const failed = error?.database === db ? error.message : null;

          return (
            <div key={db}>
              <button
                className={`tree__row ${activeDatabase === db ? 'tree__row--active' : ''}`}
                onClick={() => selectDatabase(db)}
              >
                <span className={`tree__caret ${isExpanded ? 'tree__caret--open' : ''}`}>▸</span>
                <span className="tree__icon">🗄</span>
                <span className="tree__label">{db}</span>
              </button>

              {isExpanded && (
                <div className="tree__children">
                  {loadingTables === db && <div className="tree__note">Loading…</div>}
                  {failed && <div className="tree__note tree__note--error">{failed}</div>}
                  {dbTables?.length === 0 && <div className="tree__note">No tables</div>}
                  {dbTables?.map((t) => (
                    <button
                      key={t.name}
                      className="tree__row"
                      onClick={() => onSelectTable(db, t)}
                      title={`${t.name} — click to preview`}
                    >
                      <span className="tree__caret" />
                      <span className="tree__icon">{t.kind === 'view' ? '👁' : '▦'}</span>
                      <span className="tree__label">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
