import { gutterStyle } from './resultsGridStyles.ts';

interface Props {
    r: number;
    firstRow: number;
    rowSelected: boolean;
    onSelectRow: (r: number, e: React.MouseEvent) => void;
    onOpenMenu: (e: React.MouseEvent) => void;
}

export default function ResultsGridGutterCell({
    r,
    firstRow,
    rowSelected,
    onSelectRow,
    onOpenMenu,
}: Props) {
    return (
        <td
            className="gutter"
            style={{ ...gutterStyle, ...(rowSelected ? { cursor: 'pointer' } : {}) }}
            onClick={(e) => onSelectRow(r, e)}
            onContextMenu={onOpenMenu}
            title="Click to select the row"
        >
            {firstRow + r}
        </td>
    );
}
