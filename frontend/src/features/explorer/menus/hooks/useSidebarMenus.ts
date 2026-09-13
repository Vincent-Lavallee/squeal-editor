import { useState } from 'react';
import type {
    FunctionInfo,
    TableInfo,
    TriggerInfo,
} from '../../../../../../shared/protocol/index.ts';

export type SidebarMenu =
    | { kind: 'table'; table: TableInfo; x: number; y: number }
    | {
          kind: 'trigger';
          trigger: TriggerInfo;
          table: string;
          schema?: string;
          x: number;
          y: number;
      }
    | { kind: 'function'; func: FunctionInfo; x: number; y: number }
    | null;

/**
 * The tree's right-click menu and the "drop table" confirmation it opens
 * into -- just the open/closed state. See `useSidebarMenuItems` for what
 * each menu offers. Split out of `Sidebar` purely for length.
 *
 * "Export table" is not here: unlike a drop confirmation, its dialog has to
 * survive being minimized while the export keeps running in the background,
 * which means its open/for-which-table state has to be visible to the status
 * bar too -- a sibling of the sidebar, not a descendant. See
 * `useTableExportDialog`, composed in `useShell` instead.
 */
export function useSidebarMenus() {
    const [menu, setMenu] = useState<SidebarMenu>(null);
    const [dropping, setDropping] = useState<TableInfo | null>(null);

    return { menu, setMenu, dropping, setDropping };
}
