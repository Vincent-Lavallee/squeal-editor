import type { FunctionInfo } from '../../../../../shared/protocol/index.ts';
import TreeFunctionRow from './TreeFunctionRow.tsx';
import TreeFunctionsToggle from './TreeFunctionsToggle.tsx';

interface Props {
    list: FunctionInfo[];
    db: string;
    indented: boolean;
    open: boolean;
    onToggle: () => void;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    onContextMenu: (func: FunctionInfo, x: number, y: number) => void;
}

/*
 * Functions sit behind one row rather than loose among the relations, and it
 * starts shut.
 *
 * A schema's functions are not a handful: an extension, or one audit trigger
 * per table, puts dozens of them under the same heading the tables are under
 * -- and drawn inline they read as part of the relation list, pushing the
 * tables that *are* being looked for off the bottom of the tree. One row that
 * says how many says the same thing in a line, and opening it is the same
 * gesture as opening a table.
 *
 * A filter opens it, for the reason `schemaOpen` gives: the node is built from
 * the filtered list, so drawn at all means there is a hit inside, and a shut
 * node over a match reads as "nothing found".
 */
export default function TreeFunctions({
    list,
    db,
    indented,
    open,
    onToggle,
    onShowFunctionDefinition,
    onContextMenu,
}: Props) {
    return (
        <div data-testid="tree-functions">
            <TreeFunctionsToggle
                count={list.length}
                indented={indented}
                open={open}
                onToggle={onToggle}
            />
            {open &&
                list.map((func) => (
                    <TreeFunctionRow
                        key={func.id ?? `${func.schema ?? ''}.${func.name}:${func.kind}`}
                        func={func}
                        db={db}
                        pad={indented ? 42 : 30}
                        onShowFunctionDefinition={onShowFunctionDefinition}
                        onContextMenu={onContextMenu}
                    />
                ))}
        </div>
    );
}
