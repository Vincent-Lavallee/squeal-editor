import type { FunctionInfo, TableInfo, TriggerInfo } from '../../../../../shared/protocol/index.ts';
import SidebarShell from './SidebarShell.tsx';
import { useSidebarController } from './hooks/useSidebarController.ts';

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
    onShowTriggerDefinition: (
        database: string,
        table: string,
        trigger: TriggerInfo,
        schema?: string,
    ) => void;
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

export default function Sidebar({
    shownDatabase,
    synced,
    onToggleSync,
    onSelectTable,
    onSelectDatabase,
    onShowDefinition,
    onShowTriggerDefinition,
    onShowFunctionDefinition,
    collapsed,
    onToggleCollapse,
    focusFilter,
}: Props) {
    const state = useSidebarController({
        shownDatabase,
        onSelectTable,
        onShowDefinition,
        onShowTriggerDefinition,
        onShowFunctionDefinition,
        focusFilter,
    });

    return (
        <SidebarShell
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            onSelectDatabase={onSelectDatabase}
            synced={synced}
            onToggleSync={onToggleSync}
            onShowFunctionDefinition={onShowFunctionDefinition}
            state={state}
        />
    );
}
