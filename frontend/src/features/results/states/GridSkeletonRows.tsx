import Skeleton from '../../../common/components/Skeleton.tsx';
import * as t from '../../../common/tokens';

const gutterCellStyle: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 1,
    background: t.BG,
    color: t.TEXT_FAINT,
    textAlign: 'right',
    userSelect: 'none',
    fontSize: t.TEXT_BADGE,
    height: t.ROW_H_DENSE,
    padding: '0 10px',
    borderRight: `1px solid ${t.BORDER}`,
    borderBottom: `1px solid ${t.BORDER}`,
};

const cellStyle: React.CSSProperties = {
    height: t.ROW_H_DENSE,
    padding: '0 10px',
    borderRight: `1px solid ${t.BORDER}`,
    borderBottom: `1px solid ${t.BORDER}`,
    textAlign: 'left',
    maxWidth: 380,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};

export function GridSkeletonHead({ colWidths }: { colWidths: number[] }) {
    return (
        <tr>
            <th
                className="gutter"
                style={{ ...gutterCellStyle, position: 'sticky', top: 0, zIndex: 2 }}
            >
                <Skeleton width={28} height={12} style={{ marginLeft: 'auto' }} />
            </th>
            {colWidths.map((w, i) => (
                <th
                    key={i}
                    style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        background: t.BG,
                        height: t.ROW_H_DENSE,
                        padding: '0 10px',
                        borderRight: `1px solid ${t.BORDER}`,
                        borderBottom: `1px solid ${t.BORDER}`,
                        textAlign: 'left',
                    }}
                >
                    <Skeleton width={w * 0.7} height={12} />
                </th>
            ))}
        </tr>
    );
}

export function GridSkeletonRow({ r, colWidths }: { r: number; colWidths: number[] }) {
    return (
        <tr>
            <td className="gutter" style={gutterCellStyle}>
                <Skeleton width={28} height={12} style={{ marginLeft: 'auto' }} />
            </td>
            {colWidths.map((w, c) => (
                <td key={c} style={cellStyle}>
                    <Skeleton width={w * (0.5 + ((r * 3 + c) % 7) * 0.07)} height={12} />
                </td>
            ))}
        </tr>
    );
}
