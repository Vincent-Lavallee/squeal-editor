import type { useExplorer } from '../hooks/useExplorer.ts';
import ColumnRow from './ColumnRow.tsx';
import Skeleton from '../../../common/components/Skeleton.tsx';
import * as t from '../../../common/tokens';

export default function Columns({
    columns,
    indented,
}: {
    columns: ReturnType<ReturnType<typeof useExplorer>['columnsFor']>;
    indented: boolean;
}) {
    const pad = indented ? 42 : 30;
    if (columns == null) return <ColumnsSkeleton pad={pad} />;
    if (columns.length === 0)
        return (
            <div
                data-testid="tree-note"
                style={{
                    padding: `5px 8px 5px ${pad}px`,
                    fontSize: t.TEXT_BADGE,
                    color: t.TEXT_MUTED,
                }}
            >
                No columns
            </div>
        );

    return (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {columns.map((c) => (
                <ColumnRow key={c.name} column={c} pad={pad} />
            ))}
        </ul>
    );
}

function ColumnsSkeleton({ pad }: { pad: number }) {
    return (
        <div data-testid="tree-note">
            {[0.55, 0.7, 0.4, 0.6].map((w, i) => (
                <div
                    key={i}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        height: t.ROW_H_TIGHT,
                        padding: `0 6px 0 ${pad}px`,
                    }}
                >
                    <Skeleton width={100 + w * 60} height={12} />
                    <Skeleton width={50 + w * 30} height={12} style={{ marginLeft: 'auto' }} />
                </div>
            ))}
        </div>
    );
}
