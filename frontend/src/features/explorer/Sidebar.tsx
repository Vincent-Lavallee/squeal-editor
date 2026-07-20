import { useMemo, useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { DisclosureIcon, KeyIcon, SidebarFoldIcon, SidebarUnfoldIcon, TableIcon, ViewIcon } from '../../common/icons/icons.ts';
import DropTableConfirm from './DropTableConfirm.tsx';
import { useExplorer } from './useExplorer.ts';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import Select from '../../common/components/Select.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
  onSelectTable: (database: string, table: TableInfo) => void;
  onSelectDatabase: (database: string) => void;
  onShowDefinition: (database: string, table: TableInfo) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({ onSelectTable, onSelectDatabase, onShowDefinition, collapsed, onToggleCollapse }: Props) {
  const { databases, database, hasTab, tables, columnsFor, loadTableColumns, dropTable, readOnly, loading, error } = useExplorer();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [menu, setMenu] = useState<{ table: TableInfo; x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState<TableInfo | null>(null);

  const copyName = (name: string) => void Neutralino.clipboard.writeText(name);

  // Drop is refused on a read-only connection: read-only is the server refusing
  // writes, and that does not reliably cover DDL, so honouring the intent for a
  // `DROP` is the UI's to do.
  const menuItems = (table: TableInfo, db: string): MenuItem[] => [
    { label: 'Copy name', onSelect: () => copyName(table.name) },
    { label: 'Open definition', onSelect: () => onShowDefinition(db, table) },
    { label: `Drop ${table.kind === 'view' ? 'view' : 'table'}`, danger: true, disabled: readOnly, title: readOnly ? 'This connection is read-only.' : undefined, onSelect: () => setDropping(table) },
  ];

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else { next.add(name); if (database) loadTableColumns(database, name); }
      return next;
    });
  };

  const sorted = useMemo(
    () => (tables ? [...tables].sort((a, b) => (a.kind === 'view' ? 1 : 0) - (b.kind === 'view' ? 1 : 0)) : tables),
    [tables]
  );

  return (
    <aside data-testid="sidebar" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: `1px solid ${t.BORDER}` }}>
      <div data-testid="sidebar-head" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, height: t.TAB_H, padding: `0 ${t.GAP}px`, borderBottom: collapsed ? 'none' : `1px solid ${t.BORDER}`, flex: 'none', ...(collapsed ? { justifyContent: 'center', padding: 0 } : {}) }}>
        <Select value={database ?? ''} onChange={(e) => onSelectDatabase(e.target.value)}
          disabled={!hasTab || databases.length === 0} aria-label="Database"
          data-testid="sidebar-db-select"
          style={{ flex: 1, minWidth: 0, border: '1px solid transparent', background: t.BG, display: collapsed ? 'none' : undefined }}>
          {database === null && <option value="" disabled>{databases.length === 0 ? 'No databases' : 'Select a database…'}</option>}
          {databases.map((db) => (<option key={db} value={db}>{db}</option>))}
        </Select>

        <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 22, height: 22, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer', ...(collapsed ? { marginLeft: 0 } : { marginLeft: 'auto' }) }}
          onClick={onToggleCollapse} title={collapsed ? 'Show sidebar (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'}
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}>
          {collapsed ? <SidebarUnfoldIcon style={iconSvg} aria-hidden="true" /> : <SidebarFoldIcon style={iconSvg} aria-hidden="true" />}
        </button>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: `${t.GAP_SM}px 6px`, display: collapsed ? 'none' : undefined }}>
        {loading && <div data-testid="tree-note" style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>Loading…</div>}
        {error && <div data-testid="tree-note" style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.RED_TEXT }}>{error}</div>}
        {sorted?.length === 0 && <div data-testid="tree-note" style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>No tables</div>}

        {database && sorted?.map((table) => {
          const open = expanded.has(table.name);
          return (
            <div key={table.name} data-testid="tree-item">
              <div data-testid="tree-row" style={{ display: 'flex', alignItems: 'center', height: t.ROW_H_DENSE, borderRadius: t.RADIUS }}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ table, x: e.clientX, y: e.clientY }); }}>
                <button data-testid="tree-toggle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 18, height: '100%', padding: 0, border: 'none', background: 'none', color: t.TEXT_FAINT, cursor: 'pointer' }}
                  onClick={() => toggle(table.name)} aria-expanded={open} aria-label={open ? `Collapse ${table.name}` : `Expand ${table.name}`}>
                  <DisclosureIcon style={{ ...iconSvg, transition: 'transform 0.12s ease', ...(open ? { transform: 'rotate(90deg)' } : {}) }} aria-hidden="true" />
                </button>
                <button data-testid="tree-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, height: '100%', padding: '0 6px 0 0', border: 'none', background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BODY, textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => onSelectTable(database, table)} title={`${table.name} — click to browse`}>
                  {table.kind === 'view' ? <ViewIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" /> : <TableIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />}
                  <span data-testid="tree-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{table.name}</span>
                </button>
              </div>
              {open && <Columns columns={columnsFor(database, table.name)} />}
            </div>
          );
        })}
      </nav>

      {menu && database && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.table, database)} onClose={() => setMenu(null)} />}
      {dropping && database && <DropTableConfirm table={dropping} onConfirm={async () => { await dropTable(database, dropping.name, dropping.kind); setDropping(null); }} onCancel={() => setDropping(null)} />}
    </aside>
  );
}

function Columns({ columns }: { columns: ReturnType<ReturnType<typeof useExplorer>['columnsFor']> }) {
  if (columns == null) return <div data-testid="tree-note" style={{ padding: '5px 8px 5px 30px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>Loading…</div>;
  if (columns.length === 0) return <div data-testid="tree-note" style={{ padding: '5px 8px 5px 30px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>No columns</div>;

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {columns.map((c) => (
        <li key={c.name} data-testid="tree-col" style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_DENSE, padding: '0 6px 0 30px' }}
          title={`${c.name} ${c.dataType}${c.primaryKey ? ' · primary key' : ''}`}>
          <span data-testid="tree-col-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: t.TEXT_BADGE, color: t.TEXT, fontFamily: t.MONO }}>{c.name}</span>
          {c.primaryKey && <KeyIcon data-testid="tree-key" style={{ ...iconSvg, flex: 'none', color: t.TEXT_MUTED }} aria-label="primary key" />}
          <span style={{ marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>{c.dataType}</span>
        </li>
      ))}
    </ul>
  );
}
