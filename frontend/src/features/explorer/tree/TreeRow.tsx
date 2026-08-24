import type { TableInfo, TriggerInfo } from '../../../../../shared/protocol/index.ts';
import { relationLabel, relationName, relationOf } from '../../../common/db/relation.ts';
import Columns from '../table-fields/Columns.tsx';
import Triggers from '../table-fields/Triggers.tsx';
import TreeRowHeader from './TreeRowHeader.tsx';
import type { useExplorer } from '../hooks/useExplorer.ts';

export default function TreeRow({
    table,
    indented,
    open,
    grouped,
    defaultSchema,
    onToggle,
    onSelect,
    onContextMenu,
    columns,
    triggers,
    onLoadTriggers,
    onShowTriggerDefinition,
    onTriggerContextMenu,
}: {
    table: TableInfo;
    indented: boolean;
    open: boolean;
    grouped: boolean;
    defaultSchema: string | undefined;
    onToggle: () => void;
    onSelect: () => void;
    onContextMenu: (x: number, y: number) => void;
    columns: ReturnType<ReturnType<typeof useExplorer>['columnsFor']>;
    triggers: ReturnType<ReturnType<typeof useExplorer>['triggersFor']>;
    onLoadTriggers: () => void;
    onShowTriggerDefinition: (trigger: TriggerInfo) => void;
    onTriggerContextMenu: (trigger: TriggerInfo, x: number, y: number) => void;
}) {
    const qualifiedName = relationName(relationOf(table));
    // Grouped, the heading above says which schema this is, so the row shows the
    // bare name. Flat, the label carries whatever the engine does not consider
    // implied -- `reporting.hits`, but plain `users` for the default schema.
    const label = grouped ? table.name : relationLabel(relationOf(table), defaultSchema);
    return (
        <div data-testid="tree-item">
            <TreeRowHeader
                table={table}
                label={label}
                qualifiedName={qualifiedName}
                indented={indented}
                open={open}
                onToggle={onToggle}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
            />
            {open && <Columns columns={columns} indented={indented} />}
            {open && (
                <Triggers
                    triggers={triggers}
                    table={table.name}
                    schema={table.schema}
                    indented={indented}
                    onLoadTriggers={onLoadTriggers}
                    onShowDefinition={onShowTriggerDefinition}
                    onContextMenu={onTriggerContextMenu}
                />
            )}
        </div>
    );
}
