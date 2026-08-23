import Skeleton from '../../common/components/Skeleton.tsx';
import * as t from '../../common/tokens';
import { GridSkeletonHead, GridSkeletonRow } from './GridSkeletonRows.tsx';

const COL_WIDTHS = [120, 180, 140, 100];
const ROWS = 10;

const barStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    flex: 'none',
    padding: `0 ${t.GAP_LG}px`,
    height: 32,
    borderBottom: `1px solid ${t.BORDER}`,
    fontSize: t.TEXT_BADGE,
    color: t.TEXT_MUTED,
};

const tableStyle: React.CSSProperties = {
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontFamily: t.MONO,
    fontSize: t.TEXT_BODY,
    whiteSpace: 'nowrap',
};

export default function GridSkeleton() {
    return (
        <>
            <div style={barStyle}>
                <Skeleton width={100} height={12} />
                <Skeleton width={60} height={12} style={{ marginLeft: 'auto' }} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <table className="grid" style={tableStyle}>
                    <thead>
                        <GridSkeletonHead colWidths={COL_WIDTHS} />
                    </thead>
                    <tbody>
                        {Array.from({ length: ROWS }).map((_, r) => (
                            <GridSkeletonRow key={r} r={r} colWidths={COL_WIDTHS} />
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}
