import type { SortOrder } from '../../../../shared/protocol/index.ts';
import { gutterHeadStyle } from './resultsGridStyles.ts';
import ResultsGridHeaderCell from './ResultsGridHeaderCell.tsx';

interface Props {
    columns: string[];
    sort: SortOrder | null;
    canSort: (column: string) => boolean;
    columnWidths: Record<string, number>;
    resizingColumn: string | null;
    typeOf: (col: string) => string | undefined;
    onToggleSort: (column: string) => void;
    onStartResize: (column: string) => (e: React.MouseEvent<HTMLElement>) => void;
    onClearColumnWidth: (column: string) => void;
}

export default function ResultsGridHeader({
    columns,
    sort,
    canSort,
    columnWidths,
    resizingColumn,
    typeOf,
    onToggleSort,
    onStartResize,
    onClearColumnWidth,
}: Props) {
    return (
        <thead>
            <tr>
                <th className="gutter" style={gutterHeadStyle} />
                {columns.map((col, i) => {
                    const sortedBy = sort?.column === col ? sort.direction : null;
                    return (
                        <ResultsGridHeaderCell
                            key={i}
                            col={col}
                            sortable={canSort(col)}
                            sortedBy={sortedBy}
                            width={columnWidths[col]}
                            resizingColumn={resizingColumn}
                            typeLabel={typeOf(col)}
                            onToggleSort={() => onToggleSort(col)}
                            onStartResize={onStartResize(col)}
                            onClearWidth={() => onClearColumnWidth(col)}
                        />
                    );
                })}
            </tr>
        </thead>
    );
}
