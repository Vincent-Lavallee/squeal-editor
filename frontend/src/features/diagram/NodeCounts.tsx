import * as t from '../../common/tokens';

export default function NodeCounts({
    nodeCount,
    referenceCount,
}: {
    nodeCount: number;
    referenceCount: number;
}) {
    return (
        <span
            data-testid="diagram-counts"
            style={{ flex: 'none', fontSize: t.TEXT_LABEL, color: t.TEXT_FAINT }}
        >
            {nodeCount} {nodeCount === 1 ? 'table' : 'tables'} · {referenceCount}{' '}
            {referenceCount === 1 ? 'reference' : 'references'}
        </span>
    );
}
