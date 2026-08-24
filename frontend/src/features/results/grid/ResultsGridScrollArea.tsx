import type { QueryResult } from '../../../../../shared/protocol/index.ts';
import type { useResultsGridController } from './hooks/useResultsGridController.ts';
import { gridTableStyle } from './resultsGridStyles.ts';
import ResultsGridBody from './ResultsGridBody.tsx';
import ResultsGridHeader from './ResultsGridHeader.tsx';

interface Props {
    g: ReturnType<typeof useResultsGridController>;
    result: QueryResult;
}

export default function ResultsGridScrollArea({ g, result }: Props) {
    return (
        <div
            ref={g.grid}
            data-testid="grid-scroll"
            style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
            tabIndex={0}
            onKeyDown={g.onKeyDown}
            onScroll={(e) =>
                g.rememberScroll(e.currentTarget.scrollTop, e.currentTarget.scrollLeft)
            }
        >
            <table className="grid" style={gridTableStyle}>
                <ResultsGridHeader
                    columns={result.columns}
                    sort={g.sort}
                    canSort={g.canSort}
                    columnWidths={g.columnWidths}
                    resizingColumn={g.resizing?.column ?? null}
                    typeOf={g.typeOf}
                    onToggleSort={g.toggleSort}
                    onStartResize={g.startResize}
                    onClearColumnWidth={g.clearColumnWidth}
                />
                <ResultsGridBody
                    rows={result.rows}
                    columns={result.columns}
                    columnWidths={g.columnWidths}
                    firstRow={g.firstRow}
                    selected={g.selected}
                    editing={g.editing}
                    isDeleted={g.isDeleted}
                    lookups={g.rowLookups}
                    handlers={g.rowHandlers}
                />
            </table>
        </div>
    );
}
