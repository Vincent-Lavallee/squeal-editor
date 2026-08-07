import { useEffect, useMemo, useRef, useState } from 'react';

import type { FunctionInfo, TableInfo, TriggerInfo } from '../../../../shared/protocol/index.ts';
import { relationLabel, relationName, relationOf } from '../../common/db/relation.ts';
import { CopiedIcon, DisclosureIcon, FunctionIcon, KeyIcon, RefreshIcon, SchemaIcon, SidebarFoldIcon, SidebarUnfoldIcon, StarIcon, SyncTreeIcon, TableIcon, TriggerIcon, ViewIcon } from '../../common/icons/icons.ts';
import DropTableConfirm from './DropTableConfirm.tsx';
import { useExplorer } from './useExplorer.ts';
import Badge from '../../common/components/Badge.tsx';
import Button from '../../common/components/Button.tsx';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import Input from '../../common/components/Input.tsx';
import Select from '../../common/components/Select.tsx';
import Skeleton from '../../common/components/Skeleton.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

/** A tree with nothing to show yet. Frozen and shared: a fresh `new Set()` per
 *  render would be a new identity for every memo downstream of it. */
const NO_KEYS: ReadonlySet<string> = new Set();

interface Props {
  /**
   * Which database the tree is drawing. It is the composition root's, because
   * only that can see whether `synced` means "the tab in front's" or "the last
   * one picked here". Keying the expansion state below by database is what
   * makes coming back to one find the tree the way it was left.
   */
  shownDatabase: string | null;
  /**
   * Whether the tree keeps to the database of the tab in front. It is read
   * here only to draw the toggle -- what it *does* is `Shell`'s, which is
   * where `shownDatabase` and `onSelectDatabase` both resolve against it.
   */
  synced: boolean;
  onToggleSync: () => void;
  onSelectTable: (table: TableInfo) => void;
  onSelectDatabase: (database: string) => void;
  onShowDefinition: (database: string, table: TableInfo) => void;
  onShowTriggerDefinition: (database: string, table: string, trigger: TriggerInfo, schema?: string) => void;
  onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /**
   * A counter the shell bumps to put focus in the filter, rather than a
   * boolean: focusing is an event and has no "off" for a flag to return to.
   *
   * It arrives from the shell because the shell is what un-collapses the
   * sidebar in the same gesture, and a field inside `display: none` cannot
   * take focus. Both are one batched update, so by the time the effect below
   * runs the bar is on screen. `0` is the launch value and is deliberately
   * skipped -- nothing should steal focus before the user has asked for it.
   */
  focusFilter?: number;
}

export default function Sidebar({ shownDatabase, synced, onToggleSync, onSelectTable, onSelectDatabase, onShowDefinition, onShowTriggerDefinition, onShowFunctionDefinition, collapsed, onToggleCollapse, focusFilter }: Props) {
  const { databases, database, tables, columnsFor, loadTableColumns, triggersFor, loadTableTriggers, functionsFor, dropTable, isStarred, toggleStar, refreshDatabases, refreshTables, readOnly, defaultSchema, loading, firstLoad, error } = useExplorer(shownDatabase);

  /*
   * The shape you left each database's tree in, kept per database.
   *
   * This is what turns picking another database from "the tree reset" into
   * "the tree switched". Flat state was coherent only while one database was
   * ever shown: it survived a switch by *name collision*, so expanding
   * `public.users` in one database silently opened a `public.users` in the
   * next, and everything else came back collapsed. Coming back to a database
   * should find its tree the way it was left, which means the key has to be
   * the database.
   */
  const treeKey = database ?? '';
  const [expandedByDb, setExpandedByDb] = useState<Record<string, ReadonlySet<string>>>({});
  const [flippedByDb, setFlippedByDb] = useState<Record<string, ReadonlySet<string>>>({});
  const [filterByDb, setFilterByDb] = useState<Record<string, string>>({});
  const expanded = expandedByDb[treeKey] ?? NO_KEYS;
  const flippedSchemas = flippedByDb[treeKey] ?? NO_KEYS;
  const filter = filterByDb[treeKey] ?? '';
  const setFilter = (value: string) => setFilterByDb((prev) => ({ ...prev, [treeKey]: value }));

  // Selected as well as focused, so pressing the key again over a filter you
  // have already typed replaces it rather than appending to it.
  const filterInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusFilter) return;
    filterInput.current?.focus();
    filterInput.current?.select();
  }, [focusFilter]);

  const [menu, setMenu] = useState<
    | { kind: 'table'; table: TableInfo; x: number; y: number }
    | { kind: 'trigger'; trigger: TriggerInfo; table: string; schema?: string; x: number; y: number }
    | { kind: 'function'; func: FunctionInfo; x: number; y: number }
    | null
  >(null);
  const [dropping, setDropping] = useState<TableInfo | null>(null);
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

  const functionMenuItems = (func: FunctionInfo, db: string): MenuItem[] => [
    { label: 'Copy name', onSelect: () => copyName(func.name) },
    { label: 'Open definition', onSelect: () => onShowFunctionDefinition(db, func) },
  ];

  const triggerMenuItems = (trigger: TriggerInfo, table: string, schema: string | undefined, db: string): MenuItem[] => [
    { label: 'Copy name', onSelect: () => copyName(trigger.name) },
    { label: 'Open definition', onSelect: () => onShowTriggerDefinition(db, table, trigger, schema) },
  ];

  // Keyed by the qualified name, because two schemas may each hold a `users` and
  // expanding one of them must not open the other.
  const toggle = (table: TableInfo) => {
    const key = relationName(relationOf(table));
    setExpandedByDb((prev) => {
      const next = new Set(prev[treeKey] ?? NO_KEYS);
      if (next.has(key)) next.delete(key);
      else { next.add(key); if (database) loadTableColumns(database, relationOf(table)); }
      return { ...prev, [treeKey]: next };
    });
  };

  const toggleSchema = (schema: string) => {
    setFlippedByDb((prev) => {
      const next = new Set(prev[treeKey] ?? NO_KEYS);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return { ...prev, [treeKey]: next };
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

  const functions = database ? functionsFor(database) : undefined;

  // Grouped the same way tables are, so a schema's functions can fold into that
  // schema's own heading instead of needing one of their own -- see `grouped`.
  const functionsBySchema = useMemo(() => {
    const groups = new Map<string, FunctionInfo[]>();
    if (!functions) return groups;
    for (const func of functions) {
      const schema = func.schema ?? '';
      const existing = groups.get(schema);
      if (existing) existing.push(func);
      else groups.set(schema, [func]);
    }
    return groups;
  }, [functions]);

  /*
   * MySQL reports no schema, because its database *is* its schema -- so there is
   * nothing to group by and the tree is drawn flat. That is read off the data
   * rather than off the engine: the UI does not know what MySQL is, and "these
   * relations name a schema" is exactly the question being asked anyway.
   */
  const hasSchemas =
    (unpinned?.some((table) => table.schema !== undefined) ?? false) ||
    (functions?.some((f) => f.schema !== undefined) ?? false);
  const grouped = useMemo(() => {
    if (!unpinned || !hasSchemas) return null;
    // Grouping preserves the order within each group, so the sort above still
    // holds tables over views inside every one of them.
    const groups = new Map<string, TableInfo[]>();
    for (const table of unpinned) {
      const schema = table.schema ?? '';
      const existing = groups.get(schema);
      if (existing) existing.push(table);
      else groups.set(schema, [table]);
    }
    // A schema holding functions but no tables still needs a group to render
    // them under -- a function's schema is the same fact a table's is, so it
    // folds into that schema's own heading rather than earning one of its own.
    for (const schema of functionsBySchema.keys()) {
      if (!groups.has(schema)) groups.set(schema, []);
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
  }, [unpinned, hasSchemas, defaultSchema, functionsBySchema]);

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
          onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: 'table', table, x: e.clientX, y: e.clientY }); }}>
          <button data-testid="tree-toggle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 18, height: '100%', padding: 0, border: 'none', background: 'none', color: t.TEXT_FAINT, cursor: 'pointer' }}
            onClick={() => toggle(table)} aria-expanded={open} aria-label={open ? `Collapse ${label}` : `Expand ${label}`}>
            <DisclosureIcon style={{ ...iconSvg, transition: 'transform 0.12s ease', ...(open ? { transform: 'rotate(90deg)' } : {}) }} aria-hidden="true" />
          </button>
          <button data-testid="tree-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, height: '100%', padding: '0 6px 0 0', border: 'none', background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BADGE, textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onSelectTable(table)} title={`${key} — click to browse`}>
            {table.kind === 'view' ? <ViewIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" /> : <TableIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />}
            <span data-testid="tree-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </button>
        </div>
        {open && <Columns columns={columnsFor(db, relationOf(table))} indented={indented} />}
        {open && <Triggers triggers={triggersFor(db, table.name)} table={table.name} schema={table.schema} indented={indented} onLoadTriggers={() => loadTableTriggers(db, table.name, table.schema)} onShowDefinition={(trigger) => onShowTriggerDefinition(db, table.name, trigger, table.schema)} onContextMenu={(trigger, x, y) => setMenu({ kind: 'trigger', trigger, table: table.name, schema: table.schema, x, y })} />}
      </div>
    );
  };

  // A function row shares the table row's shape (name, icon, context menu) but
  // has nothing to disclose -- no columns, no triggers -- so the toggle button
  // becomes an inert spacer, keeping the name lined up with a table's own.
  //
  // Its own testids throughout, never `tree-item`/`tree-label`: those name a
  // *relation*, which the UI suite reads schema groups by (`treeLabelsIn`, the
  // tables-above-views ordering check) -- a function folded into a schema
  // group under those same ids would read as one more relation and land after
  // every view, breaking "the view is last in its group" the moment a schema
  // holds both.
  const renderFunctionRow = (func: FunctionInfo, db: string, indented: boolean) => (
    <div key={func.name} data-testid="tree-function-item">
      <div data-testid="tree-function-row" style={{ display: 'flex', alignItems: 'center', height: t.ROW_H_DENSE, borderRadius: t.RADIUS, paddingLeft: indented ? 12 : 0 }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: 'function', func, x: e.clientX, y: e.clientY }); }}>
        <div style={{ flex: 'none', width: 18 }} aria-hidden="true" />
        <button data-testid="tree-function-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, height: '100%', padding: '0 6px 0 0', border: 'none', background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BADGE, textAlign: 'left', cursor: 'pointer' }}
          onClick={() => onShowFunctionDefinition(db, func)} title={`${func.name} — click to view definition`}>
          <FunctionIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
          <span data-testid="tree-function-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{func.name}</span>
          <span style={{ marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.TEXT_MUTED, fontSize: '0.85em' }}>{func.kind}</span>
        </button>
      </div>
    </div>
  );

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
        <Input ref={filterInput} variant="bare" value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tables…" aria-label="Filter tables"
          data-testid="sidebar-filter" style={{ flex: 1, minWidth: 0 }} />

        {/*
          * The control lives here rather than in Settings, which does not exist:
          * the choice is about the tree in front of you, and a preference you have
          * to leave the tree to change is one nobody finds.
          */}
        {/*
          * Refresh before the sync toggle, not after: the header above ends in
          * [db-refresh][collapse], so this bar's last slot has to be the other
          * toggle-like control for the two refresh icons to land in the same
          * column instead of one sitting a button-width off.
          */}
        <Button variant="ghost" style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0 }}
          onClick={refreshTables} disabled={!database || loading}
          title="Refresh tables" aria-label="Refresh tables"
          data-testid="sidebar-tables-refresh">
          <RefreshIcon className={loading ? 'spin' : undefined} style={iconSvg} aria-hidden="true" />
        </Button>

        {/*
          * Unlike every other toggle in this bar's history, it is drawn on every
          * engine: what it pairs is the tree and the tab, which every connection
          * has, rather than a schema layer only some of them report.
          */}
        <Button variant="ghost" style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0, ...(synced ? { color: t.ACCENT } : {}) }}
          onClick={onToggleSync}
          title={synced ? 'The tree follows the tab in front (Ctrl+Shift+B)' : 'Keep the tree on the tab\'s database (Ctrl+Shift+B)'}
          aria-label={synced ? 'Stop the tree following the tab' : "Keep the tree on the tab's database"}
          aria-pressed={synced}
          data-testid="sidebar-sync-toggle">
          <SyncTreeIcon style={iconSvg} aria-hidden="true" />
        </Button>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: `${t.GAP_SM}px 6px`, display: collapsed ? 'none' : undefined }}>
        {firstLoad && <TreeSkeleton />}
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
          const schemaFunctions = functionsBySchema.get(schema) ?? [];
          const count = group.length + schemaFunctions.length;
          return (
            <div key={schema} data-testid="tree-schema">
              <button data-testid="tree-schema-row" style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: t.ROW_H_DENSE, padding: '0 6px 0 0', border: 'none', background: 'none', color: t.TEXT_MUTED, font: 'inherit', fontSize: t.TEXT_BADGE, textAlign: 'left', cursor: 'pointer', borderRadius: t.RADIUS }}
                onClick={() => toggleSchema(schema)} aria-expanded={open}
                title={`${schema} — ${count} ${count === 1 ? 'item' : 'items'}`}>
                <DisclosureIcon style={{ ...iconSvg, flex: 'none', color: t.TEXT_FAINT, transition: 'transform 0.12s ease', ...(open ? { transform: 'rotate(90deg)' } : {}) }} aria-hidden="true" />
                <SchemaIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
                <span data-testid="tree-schema-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{schema}</span>
              </button>
              {open && group.map((table) => renderRow(table, database, true))}
              {open && schemaFunctions.map((func) => renderFunctionRow(func, database, true))}
            </div>
          );
        })}

        {database && !grouped && unpinned?.map((table) => renderRow(table, database, false))}

        {/*
          * Only reached when nothing schema-groups functions above -- flat mode,
          * or an engine with no schema layer (MySQL). There each function has no
          * heading of its own to fold under, so this is the one place it still
          * earns one.
          */}
        {database && !grouped && functions && functions.length > 0 && (
          <div data-testid="tree-functions" style={{ marginTop: t.GAP_SM, paddingTop: t.GAP_SM, borderTop: `1px solid ${t.BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: t.ROW_H_DENSE, padding: '0 6px', color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}>
              <FunctionIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
              <span>Functions</span>
            </div>
            {functions.map((func) => renderFunctionRow(func, database, false))}
          </div>
        )}
      </nav>

      {menu && database && menu.kind === 'table' && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.table, database)} onClose={() => setMenu(null)} />}
      {menu && database && menu.kind === 'trigger' && <ContextMenu x={menu.x} y={menu.y} items={triggerMenuItems(menu.trigger, menu.table, menu.schema, database)} onClose={() => setMenu(null)} />}
      {menu && database && menu.kind === 'function' && <ContextMenu x={menu.x} y={menu.y} items={functionMenuItems(menu.func, database)} onClose={() => setMenu(null)} />}
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
        <li key={c.name} data-testid="tree-col" style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_TIGHT, padding: `0 6px 0 ${pad}px` }}
          title={`${c.name} ${c.dataType}${c.primaryKey ? ' · primary key' : ''}`}>
          {/*
            * The name keeps `flex-shrink: 1` (the default weight) and the type
            * a wildly higher one, so flexbox's proportional shrink -- which
            * would otherwise clip both together as the sidebar narrows -- gives
            * nearly all of the negative space to the type first. The type
            * reaches its `minWidth: 0` floor (invisible) long before the name
            * loses a pixel; only once it is fully gone does the name start to
            * truncate, which is the two-stage priority asked for without
            * measuring anything in JS.
            */}
          <span data-testid="tree-col-name" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: t.TEXT_BADGE, color: t.TEXT, fontFamily: t.MONO }}>{c.name}</span>
          {c.primaryKey && <KeyIcon data-testid="tree-key" style={{ ...iconSvg, flex: 'none', color: t.TEXT_MUTED }} aria-label="primary key" />}
          <span style={{ flex: '0 999 auto', minWidth: 0, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>{c.dataType}</span>
        </li>
      ))}
    </ul>
  );
}

function Triggers({ triggers, table, schema: _schema, indented, onLoadTriggers, onShowDefinition, onContextMenu }: { triggers: ReturnType<ReturnType<typeof useExplorer>['triggersFor']>; table: string; schema?: string; indented: boolean; onLoadTriggers: () => void; onShowDefinition: (trigger: TriggerInfo) => void; onContextMenu: (trigger: TriggerInfo, x: number, y: number) => void }) {
  const pad = indented ? 42 : 30;

  // Load triggers when first rendered if not already loaded
  useEffect(() => {
    if (triggers === undefined) {
      onLoadTriggers();
    }
  }, [table, triggers, onLoadTriggers]);

  if (triggers == null) return null;
  if (triggers.length === 0) return null;

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {triggers.map((trigger) => (
        <li key={trigger.name} data-testid="tree-trigger" style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_DENSE, padding: `0 6px 0 ${pad}px` }}
          onContextMenu={(e) => { e.preventDefault(); onContextMenu(trigger, e.clientX, e.clientY); }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, height: '100%', padding: 0, border: 'none', background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BADGE, textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onShowDefinition(trigger)} title={`${trigger.name} — click to view definition`}>
            <TriggerIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trigger.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/*
 * Its own testid rather than the `tree-note` its siblings share: the suite has
 * to be able to assert a refresh did *not* draw one, and "no note" would also
 * be true of a tree that had gone blank -- the very failure this replaced.
 */
function TreeSkeleton() {
  return (
    <div data-testid="tree-skeleton">
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
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_TIGHT, padding: `0 6px 0 ${pad}px` }}>
          <Skeleton width={100 + w * 60} height={12} />
          <Skeleton width={50 + w * 30} height={12} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}
