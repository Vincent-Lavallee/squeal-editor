import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { relationName, relationOf } from '../../common/db/relation.ts';
import { StarIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import ConnectedTreeRow from './ConnectedTreeRow.tsx';
import type { TreeRowContext } from './TreeRowContext.ts';

export default function TreePinnedGroup({
    pinned,
    ctx,
}: {
    pinned: TableInfo[];
    ctx: TreeRowContext;
}) {
    return (
        <div
            data-testid="tree-pinned"
            style={{
                marginBottom: t.GAP_SM,
                paddingBottom: t.GAP_SM,
                borderBottom: `1px solid ${t.BORDER}`,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    height: t.ROW_H_DENSE,
                    padding: '0 6px',
                    color: t.ACCENT,
                    fontSize: t.TEXT_BADGE,
                }}
            >
                <StarIcon style={{ width: 16, height: 16, color: t.ACCENT }} aria-hidden="true" />
                <span>Starred</span>
            </div>
            {pinned.map((table) => (
                <ConnectedTreeRow
                    key={relationName(relationOf(table))}
                    table={table}
                    indented={false}
                    ctx={ctx}
                />
            ))}
        </div>
    );
}
