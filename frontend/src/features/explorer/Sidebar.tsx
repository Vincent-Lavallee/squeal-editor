import { useEffect, useMemo, useRef, useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { relationLabel, relationName, relationOf } from '../../common/db/relation.ts';
import { CopiedIcon, DisclosureIcon, FlatTreeIcon, KeyIcon, RefreshIcon, SchemaIcon, SidebarFoldIcon, SidebarUnfoldIcon, StarIcon, TableIcon, ViewIcon } from '../../common/icons/icons.ts';
import DropTableConfirm from './DropTableConfirm.tsx';
import { useExplorer } from './useExplorer.ts';
import Badge from '../../common/components/Badge.tsx';
import Button from '../../common/components/Button.tsx';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import Input from '../../common/components/Input.tsx';
import Select from '../../common/components/Select.tsx';
import Skeleton from '../../common/components/Skeleton.tsx';
import { useBooleanSetting } from '../../store/settingsSlice.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

/**
 * Grouping is remembered globally, so it is a preference about trees rather than
 * a fact about one server -- moving to another connection keeps the shape you
 * chose. Grouped is the default: a flat run of a hundred relations is the state
 * the grouping exists to fix, so the fix should not have to be found first.
 */
const GROUP_BY_SCHEMA = 'tree.groupBySchema';

interface Props {
  onSelectTable: (database: string, table: TableInfo) => void;
  onSelectDatabase: (database: string) => void;
  onShowDefinition: (database: string, table: TableInfo) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({ onSelectTable, onSelectDatabase, onShowDefinition, collapsed, onToggleCollapse }: Props) {
  const { databases, database, tables, columnsFor, loadTableColumns, dropTable, isStarred, toggleStar, refreshDatabases, refreshTables, readOnly, defaultSchema, loading, error } = useExplorer();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [flippedSchemas, setFlippedSchemas] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ table: TableInfo; x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState<TableInfo | null>(null);
  const [groupBySchema, setGroupBySchema] = useBooleanSetting(GROUP_BY_SCHEMA, true);
  // No store flag for this one -- see `refreshDatabases` -- so the spinner is
  // this click's alone, not a fact the tree needs to know either.
  const [refreshingDatabases, setRefreshingDatabases] = useState(false);
  // 'hiding' plays the entrance animation in reverse rather than vanishing
  // outright -- an abrupt unmount was the thing this state exists to avoid.
  const [copyHint, setCopyHint] = useState<'idle' | 'shown' | 'hiding'>('idle');
  const copyHintTimer = useRef<ReturnType<typeof setTimeout>>();

  const copyName = (name: string) => void Neutralino.clipboard.writeText(name);

  // The tree's "Copy name" has a title tooltip to lean on; the picker has
  // nothing beside it, so the hint is the only way this ever gets noticed.
  const copyDatabaseName = () => {
    if (!database) return;
    copyName(database);
    clearTimeout(copyHintTimer.current);
    setCopyHint('shown');
    copyHintTimer.current = setTimeout(() => {
      setCopyHint('hiding');
      copyHintTimer.current = setTimeout(() => setCopyHint('idle'), 160);
    }, 1200);
  };

  useEffect(() => () => clearTimeout(copyHintTimer.current), []);

  const onRefreshDatabases = () => {
    setRefreshingDatabases(true);
    void refreshDatabases().finally(() => setRefreshingDatabases(false));
  };

  // Drop is refused on a read-only connection: read-only is the server refusing
  // writes, and that does not reliably cover DDL, so honouring the intent for a
  // `DROP` is the UI's to do.
  const menuItems = (table: TableInfo, db: string): MenuItem[] => {
    const starred = isStarred(db, relationOf(table));
    return [
      // The name as it reads, not the cache's key: what lands on the clipboard is
      // what you would type, and `public.` is not something anyone types.
      { label: 'Copy name', onSelect: () => copyName(relationLabel(relationOf(table), defaultSchema)) },
      { label: 'Open definition', onSelect: () => onShowDefinition(db, table) },
      { label: starred ? 'Unstar' : 'Star', onSelect: () => toggleStar(db, relationOf(table), !starred) },
      { label: `Drop ${table.kind === 'view' ? 'view' : 'table'}`, danger: true, disabled: readOnly, title: readOnly ? 'This connection is read-only.' : undefined, onSelect: () => setDropping(table) },
    ];
  };

  // Keyed by the qualified name, because two schemas may each hold a `users` and
  // expanding one of them must not open the other.
  const toggle = (table: TableInfo) => {
    const key = relationName(relationOf(table));
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else { next.add(key); if (database) loadTableColumns(database, relationOf(table)); }
      return next;
    });
  };

  const toggleSchema = (schema: string) => {
    setFlippedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
  };

  const sorted = useMemo(
    () => (tables ? [...tables].sort((a, b) => (a.kind === 'view' ? 1 : 0) - (b.kind === 'view' ? 1 : 0)) : tables),
    [tables]
  );

  // Names only. Columns are fetched lazily per expanded table, so matching them
  // would find hits in whatever happens to be open and silently miss every table
  // that is not -- a filter that answers differently depending on what you expanded.
  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (sorted && query ? sorted.filter((table) => table.name.toLowerCase().includes(query)) : sorted),
    [sorted, query]
  );
  const filteredEverythingOut = query !== '' && visible?.length === 0 && (sorted?.length ?? 0) > 0;

  /*
   * Starred tables lift into their own group at the top and drop out of the
   * list below rather than repeating in it -- `unpinned` is what every schema
   * grouping and the flat fallback below actually renders. Both keep the sort
   * above's tables-over-views order, since filtering preserves it.
   */
  const pinned = useMemo(
    () => (visible && database ? visible.filter((table) => isStarred(database, relationOf(table))) : null),
    [visible, database, isStarred]
  );
  const unpinned = useMemo(
    () => (visible && database ? visible.filter((table) => !isStarred(database, relationOf(table))) : visible),
    [visible, database, isStarred]
  );

  /*
   * A group starts open only if it is the schema you are already in -- the rest
   * are shut, because a dozen schemas all open cost the same scroll that grouping
   * exists to remove. Which schema that is comes from the engine
   * (`defaultSchema`), not from the UI knowing what `public` is.
   *
   * The state is which groups have been *flipped away* from that default rather
   * than which are collapsed, so the default applies to a schema that has not
   * been seen yet. A set of collapsed names would have to be seeded, and there is
   * nothing to seed it from until the tables land -- a different moment per
   * database, per connection, and always after the first render.
   */
  const schemaOpen = (schema: string): boolean =>
    // A filter reveals every group it matched in. The groups are built from the
    // filtered list, so a group drawn at all has a hit inside it -- and a heading
    // sitting shut over a match reads as "nothing found" about a search that
    // found something. Flipping one while filtering still works, and the tree
    // returns to the shape you chose when the filter clears.
    query !== '' || (schema === defaultSchema) !== flippedSchemas.has(schema);

  /*
   * MySQL reports no schema, because its database *is* its schema -- so there is
   * nothing to group by and the toggle does not apply. That is read off the data
   * rather than off the engine: the UI does not know what MySQL is, and "these
   * relations name a schema" is exactly the question being asked anyway.
   */
  const hasSchemas = unpinned?.some((table) => table.schema !== undefined) ?? false;
  const grouped = useMemo(() => {
    if (!unpinned || !hasSchemas || !groupBySchema) return null;
    // Grouping preserves the order within each group, so the sort above still
    // holds tables over views inside every one of them.
    const groups = new Map<string, TableInfo[]>();
    for (const table of unpinned) {
      const schema = table.schema ?? '';
      const existing = groups.get(schema);
      if (existing) existing.push(table);
      else groups.set(schema, [table]);
    }
    // The schema you are in comes first, then the rest alphabetically: it holds
    // the tables being worked on, it is the one group that starts open, and a
    // heading that opens onto rows should not sit below several that do not.
    return [...groups].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === defaultSchema) return -1;
      if (b === defaultSchema) return 1;
      return a.localeCompare(b);
    });
  }, [unpinned, hasSchemas, groupBySchema, defaultSchema]);

  const renderRow = (table: TableInfo, db: string, indented: boolean) => {
    const key = relationName(relationOf(table));
    const open = expanded.has(key);
    // Grouped, the heading above says which schema this is, so the row shows the
    // bare name. Flat, the label carries whatever the engine does not consider
    // implied -- `reporting.hits`, but plain `users` for the default schema.
    const label = grouped ? table.name : relationLabel(relationOf(table), defaultSchema);
    return (
      <div key={key} data-testid="tree-item">
        <div data-testid="tree-row" style={{ display: 'flex', alignItems: 'center', height: t.ROW_H_DENSE, borderRadius: t.RADIUS, paddingLeft: indented ? 12 : 0 }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ table, x: e.clientX, y: e.clientY }); }}>
          <button data-testid="tree-toggle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 18, height: '100%', padding: 0, border: 'none', background: 'none', color: t.TEXT_FAINT, cursor: 'pointer' }}
            onClick={() => toggle(table)} aria-expanded={open} aria-label={open ? `Collapse ${label}` : `Expand ${label}`}>
            <DisclosureIcon style={{ ...iconSvg, transition: 'transform 0.12s ease', ...(open ? { transform: 'rotate(90deg)' } : {}) }} aria-hidden="true" />
          </button>
          <button data-testid="tree-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, height: '100%', padding: '0 6px 0 0', border: 'none', background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BADGE, textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onSelectTable(db, table)} title={`${key} — click to browse`}>
            {table.kind === 'view' ? <ViewIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" /> : <TableIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />}
            <span data-testid="tree-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </button>
        </div>
        {open && <Columns columns={columnsFor(db, relationOf(table))} indented={indented} />}
      </div>
    );
  };

  return (
    <aside data-testid="sidebar" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: `1px solid ${t.BORDER}` }}>
      <div data-testid="sidebar-head" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, height: t.TAB_H, padding: '0 6px', borderBottom: collapsed ? 'none' : `1px solid ${t.BORDER}`, flex: 'none', ...(collapsed ? { justifyContent: 'center', padding: 0 } : {}) }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, display: collapsed ? 'none' : 'block' }}
          onContextMenu={(e) => { e.preventDefault(); copyDatabaseName(); }}>
          <Select variant="bare" searchable value={database ?? ''} onSelect={onSelectDatabase}
            options={databases.map((db) => ({ value: db, label: db }))}
            placeholder={databases.length === 0 ? 'No databases' : 'Select a database…'}
            disabled={databases.length === 0} aria-label="Database"
            data-testid="sidebar-db-select"
            title={database ? `${database} — right-click to copy` : undefined}
            style={{ width: '100%' }} />

          {copyHint !== 'idle' && (
            // The badge recipe already used for the engine chip, not a one-off
            // tooltip box: a pill + checkmark reads as a toast rather than as a
            // debug label, and it pops in/out instead of snapping. The full
            // database name stays out of it on purpose -- a SQLite one is a full
            // file path, easily wider than the sidebar, and the confirmation is
            // "it copied", not "here is what", which the picker already shows.
            <div role="status" data-testid="sidebar-db-copied" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50 }}>
              <Badge kind="green" style={{
                animation: copyHint === 'hiding'
                  ? 'copy-hint-pop 0.16s ease-in reverse both'
                  : 'copy-hint-pop 0.16s ease-out both',
              }}>
                <CopiedIcon style={iconSvg} aria-hidden="true" />
                Copied
              </Badge>
            </div>
          )}
        </div>

        {!collapsed && (
          <Button variant="ghost" style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0 }}
            onClick={onRefreshDatabases} disabled={refreshingDatabases}
            title="Refresh databases" aria-label="Refresh databases"
            data-testid="sidebar-db-refresh">
            <RefreshIcon className={refreshingDatabases ? 'spin' : undefined} style={iconSvg} aria-hidden="true" />
          </Button>
        )}

        <Button variant="ghost" style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0, ...(collapsed ? { marginLeft: 0 } : { marginLeft: 'auto' }) }}
          onClick={onToggleCollapse} title={collapsed ? 'Show sidebar (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'}
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}>
          {collapsed ? <SidebarUnfoldIcon style={iconSvg} aria-hidden="true" /> : <SidebarFoldIcon style={iconSvg} aria-hidden="true" />}
        </Button>
      </div>

      <div data-testid="sidebar-filter-bar" style={{ display: collapsed ? 'none' : 'flex', alignItems: 'center', gap: t.GAP_XS, height: t.TAB_H, padding: '0 6px', borderBottom: `1px solid ${t.BORDER}`, flex: 'none' }}>
        <Input variant="bare" value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tables…" aria-label="Filter tables"
          data-testid="sidebar-filter" style={{ flex: 1, minWidth: 0 }} />

        {/*
          * The control lives here rather than in Settings, which does not exist:
          * the choice is about the tree in front of you, and a preference you have
          * to leave the tree to change is one nobody finds. It is absent on an
          * engine with no schemas -- a toggle that could only ever do nothing.
          */}
        {/*
          * Refresh before the group toggle, not after: the header above ends in
          * [db-refresh][collapse], so this bar's last slot has to be the other
          * toggle-like control (group-by-schema) for the two refresh icons to
          * land in the same column instead of one sitting a button-width off.
          */}
        <Button variant="ghost" style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0 }}
          onClick={refreshTables} disabled={!database || loading}
          title="Refresh tables" aria-label="Refresh tables"
          data-testid="sidebar-tables-refresh">
          <RefreshIcon className={loading ? 'spin' : undefined} style={iconSvg} aria-hidden="true" />
        </Button>

        {hasSchemas && (
          <Button variant="ghost" style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0 }}
            onClick={() => setGroupBySchema(!groupBySchema)}
            title={groupBySchema ? 'Show every table in one list' : 'Group tables by schema'}
            aria-label={groupBySchema ? 'Show every table in one list' : 'Group tables by schema'}
            aria-pressed={groupBySchema}
            data-testid="sidebar-group-toggle">
            {groupBySchema ? <FlatTreeIcon style={iconSvg} aria-hidden="true" /> : <SchemaIcon style={iconSvg} aria-hidden="true" />}
          </Button>
        )}
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: `${t.GAP_SM}px 6px`, display: collapsed ? 'none' : undefined }}>
        {loading && <TreeSkeleton />}
        {error && <div data-testid="tree-note" style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.RED_TEXT }}>{error}</div>}
        {sorted?.length === 0 && <div data-testid="tree-note" style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>No tables</div>}
        {filteredEverythingOut && <div data-testid="tree-note" style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>No matches</div>}

        {database && pinned && pinned.length > 0 && (
          <div data-testid="tree-pinned" style={{ marginBottom: t.GAP_SM, paddingBottom: t.GAP_SM, borderBottom: `1px solid ${t.BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: t.ROW_H_DENSE, padding: '0 6px', color: t.ACCENT, fontSize: t.TEXT_BADGE }}>
              <StarIcon style={{ ...iconSvg, color: t.ACCENT }} aria-hidden="true" />
              <span>Starred</span>
            </div>
            {pinned.map((table) => renderRow(table, database, false))}
          </div>
        )}

        {database && grouped?.map(([schema, group]) => {
          const open = schemaOpen(schema);
          return (
            <div key={schema} data-testid="tree-schema">
              <button data-testid="tree-schema-row" style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: t.ROW_H_DENSE, padding: '0 6px 0 0', border: 'none', background: 'none', color: t.TEXT_MUTED, font: 'inherit', fontSize: t.TEXT_BADGE, textAlign: 'left', cursor: 'pointer', borderRadius: t.RADIUS }}
                onClick={() => toggleSchema(schema)} aria-expanded={open}
                title={`${schema} — ${group.length} ${group.length === 1 ? 'relation' : 'relations'}`}>
                <DisclosureIcon style={{ ...iconSvg, flex: 'none', color: t.TEXT_FAINT, transition: 'transform 0.12s ease', ...(open ? { transform: 'rotate(90deg)' } : {}) }} aria-hidden="true" />
                <SchemaIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
                <span data-testid="tree-schema-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{schema}</span>
              </button>
              {open && group.map((table) => renderRow(table, database, true))}
            </div>
          );
        })}

        {database && !grouped && unpinned?.map((table) => renderRow(table, database, false))}
      </nav>

      {menu && database && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.table, database)} onClose={() => setMenu(null)} />}
      {dropping && database && <DropTableConfirm table={dropping} onConfirm={async () => { await dropTable(database, relationOf(dropping), dropping.kind); setDropping(null); }} onCancel={() => setDropping(null)} />}
    </aside>
  );
}

function Columns({ columns, indented }: { columns: ReturnType<ReturnType<typeof useExplorer>['columnsFor']>; indented: boolean }) {
  const pad = indented ? 42 : 30;
  if (columns == null) return <ColumnsSkeleton pad={pad} />;
  if (columns.length === 0) return <div data-testid="tree-note" style={{ padding: `5px 8px 5px ${pad}px`, fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>No columns</div>;

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {columns.map((c) => (
        <li key={c.name} data-testid="tree-col" style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_DENSE, padding: `0 6px 0 ${pad}px` }}
          title={`${c.name} ${c.dataType}${c.primaryKey ? ' · primary key' : ''}`}>
          <span data-testid="tree-col-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: t.TEXT_BADGE, color: t.TEXT, fontFamily: t.MONO }}>{c.name}</span>
          {c.primaryKey && <KeyIcon data-testid="tree-key" style={{ ...iconSvg, flex: 'none', color: t.TEXT_MUTED }} aria-label="primary key" />}
          <span style={{ marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>{c.dataType}</span>
        </li>
      ))}
    </ul>
  );
}

function TreeSkeleton() {
  return (
    <div data-testid="tree-note">
      {[0.55, 0.7, 0.45, 0.65, 0.5, 0.75, 0.4, 0.6].map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_DENSE, padding: '0 6px' }}>
          <Skeleton width={16} height={16} borderRadius={3} style={{ flex: 'none' }} />
          <Skeleton width={`${w * 100}%`} height={12} style={{ maxWidth: 180 }} />
        </div>
      ))}
    </div>
  );
}

function ColumnsSkeleton({ pad }: { pad: number }) {
  return (
    <div data-testid="tree-note">
      {[0.55, 0.7, 0.4, 0.6].map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_DENSE, padding: `0 6px 0 ${pad}px` }}>
          <Skeleton width={100 + w * 60} height={12} />
          <Skeleton width={50 + w * 30} height={12} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}
