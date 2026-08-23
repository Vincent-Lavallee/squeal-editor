import type { CellValue } from '../../../../shared/protocol/index.ts';
import { cellBase, columnSize } from './resultsGridStyles.ts';
import ResultsGridCellContent from './ResultsGridCellContent.tsx';

interface Props {
    r: number;
    c: number;
    columnName: string;
    width: number | undefined;
    isEditing: boolean;
    value: CellValue;
    dirty: boolean;
    selected: boolean;
    isFk: boolean;
    canNull: boolean;
    boxShadow: string | undefined;
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseEnter: (e: React.MouseEvent) => void;
    onClick: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onCommit: (draft: string) => void;
    onNull: () => void;
    onCancelEdit: () => void;
    onNavigateForeignKey: () => void;
}

export default function ResultsGridCell({
    c,
    columnName,
    width,
    isEditing,
    value,
    dirty,
    selected,
    isFk,
    canNull,
    boxShadow,
    onMouseDown,
    onMouseEnter,
    onClick,
    onDoubleClick,
    onContextMenu,
    onCommit,
    onNull,
    onCancelEdit,
    onNavigateForeignKey,
}: Props) {
    const cellCls =
        [
            isEditing && 'grid__cell--editing',
            selected && 'grid__cell--selected',
            dirty && 'grid__cell--dirty',
        ]
            .filter(Boolean)
            .join(' ') || undefined;
    return (
        <td
            key={c}
            className={cellCls}
            style={{ ...cellBase, ...columnSize(width), boxShadow }}
            onMouseDown={onMouseDown}
            onMouseEnter={onMouseEnter}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
        >
            <ResultsGridCellContent
                isEditing={isEditing}
                value={value}
                isFk={isFk}
                canNull={canNull}
                columnName={columnName}
                onCommit={onCommit}
                onNull={onNull}
                onCancel={onCancelEdit}
                onNavigateForeignKey={onNavigateForeignKey}
            />
        </td>
    );
}
