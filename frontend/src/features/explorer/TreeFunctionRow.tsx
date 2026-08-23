import type { FunctionInfo } from '../../../../shared/protocol/index.ts';
import * as t from '../../common/tokens';
import TreeFunctionNameButton from './TreeFunctionNameButton.tsx';

interface Props {
    func: FunctionInfo;
    db: string;
    pad: number;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    onContextMenu: (func: FunctionInfo, x: number, y: number) => void;
}

/*
 * A function row nests the way a column or a trigger does -- one level in from
 * the node that discloses it, with no toggle of its own, because there is
 * nothing under a function to open.
 *
 * The label carries the argument list where the engine reports one. Postgres
 * overloads share a name and a schema, so `square` drawn five times is five
 * rows that look like a rendering bug and open the same definition;
 * `square(x integer)` beside `square(x text)` is the fact that tells them
 * apart. The key is the same problem: `id` is the catalog's own handle and the
 * only thing unique per row -- keyed by name, React saw duplicates. Where an
 * engine reports no id, the kind is still part of the fallback key: MySQL
 * keys its routines on name *and* type, so one database may hold both a
 * `square` function and a `square` procedure.
 *
 * Its own testids throughout, never `tree-item`/`tree-label`: those name a
 * *relation*, which the UI suite reads schema groups by (`treeLabelsIn`, the
 * tables-above-views ordering check) -- a function folded into a schema
 * group under those same ids would read as one more relation and land after
 * every view, breaking "the view is last in its group" the moment a schema
 * holds both.
 */
export default function TreeFunctionRow({
    func,
    db,
    pad,
    onShowFunctionDefinition,
    onContextMenu,
}: Props) {
    const label = func.args === undefined ? func.name : `${func.name}(${func.args})`;
    return (
        <div
            key={func.id ?? `${func.schema ?? ''}.${func.name}:${func.kind}`}
            data-testid="tree-function-item"
        >
            <div
                data-testid="tree-function-row"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    height: t.ROW_H_DENSE,
                    borderRadius: t.RADIUS,
                    paddingLeft: pad,
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(func, e.clientX, e.clientY);
                }}
            >
                <TreeFunctionNameButton
                    func={func}
                    label={label}
                    onClick={() => onShowFunctionDefinition(db, func)}
                />
            </div>
        </div>
    );
}
