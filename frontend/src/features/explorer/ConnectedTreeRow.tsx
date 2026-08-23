import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { relationName, relationOf } from '../../common/db/relation.ts';
import TreeRow from './TreeRow.tsx';
import type { TreeRowContext } from './TreeRowContext.ts';

/**
 * A `TreeRow` wired up to the tree's shared state -- the tables it draws
 * differ, but expansion, the database and the menu callbacks are the same
 * for every one of them. Split out of `Sidebar` purely for length: the three
 * places a row is drawn (pinned, grouped, flat) were repeating this wiring
 * near-verbatim.
 */
export default function ConnectedTreeRow({
    table,
    indented,
    ctx,
}: {
    table: TableInfo;
    indented: boolean;
    ctx: TreeRowContext;
}) {
    const key = relationName(relationOf(table));
    return (
        <TreeRow
            table={table}
            indented={indented}
            open={ctx.expanded.has(key)}
            grouped={ctx.grouped}
            defaultSchema={ctx.defaultSchema}
            onToggle={() => ctx.onToggle(table)}
            onSelect={() => ctx.onSelectTable(table)}
            onContextMenu={(x, y) => ctx.onOpenMenu({ kind: 'table', table, x, y })}
            columns={ctx.columnsFor(ctx.database, relationOf(table))}
            triggers={ctx.triggersFor(ctx.database, table.name)}
            onLoadTriggers={() => ctx.loadTableTriggers(ctx.database, table.name, table.schema)}
            onShowTriggerDefinition={(trigger) =>
                ctx.onShowTriggerDefinition(ctx.database, table.name, trigger, table.schema)
            }
            onTriggerContextMenu={(trigger, x, y) =>
                ctx.onOpenMenu({
                    kind: 'trigger',
                    trigger,
                    table: table.name,
                    schema: table.schema,
                    x,
                    y,
                })
            }
        />
    );
}
