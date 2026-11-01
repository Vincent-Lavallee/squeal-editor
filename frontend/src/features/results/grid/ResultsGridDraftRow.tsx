import type { CellValue } from '../../../../../shared/protocol/index.ts';
import ResultsGridDraftCell from './ResultsGridDraftCell.tsx';
import { gutterStyle } from './resultsGridStyles.ts';

interface Props {
    columns: string[];
    columnWidths: Record<string, number>;
    values: Record<string, CellValue>;
    editingColumn: string | null;
    onStartEdit: (column: string) => void;
    onCommit: (column: string, draft: string) => void;
    onNull: (column: string) => void;
    onUseDefault: (column: string) => void;
    onCancelEdit: () => void;
    onRemove: () => void;
}

export default function ResultsGridDraftRow({
    columns,
    columnWidths,
    values,
    editingColumn,
    onStartEdit,
    onCommit,
    onNull,
    onUseDefault,
    onCancelEdit,
    onRemove,
}: Props) {
    return (
        <tr className="grid__row--draft" data-testid="draft-row">
            <td className="gutter" style={gutterStyle}>
                <button
                    type="button"
                    data-testid="draft-remove"
                    title="Remove this new row"
                    style={{
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        font: 'inherit',
                        cursor: 'pointer',
                    }}
                    onClick={onRemove}
                >
                    ×
                </button>
            </td>
            {columns.map((column) => (
                <ResultsGridDraftCell
                    key={column}
                    columnName={column}
                    width={columnWidths[column]}
                    staged={values[column]}
                    isEditing={editingColumn === column}
                    onStartEdit={() => onStartEdit(column)}
                    onCommit={(draft) => onCommit(column, draft)}
                    onNull={() => onNull(column)}
                    onUseDefault={() => onUseDefault(column)}
                    onCancelEdit={onCancelEdit}
                />
            ))}
        </tr>
    );
}
