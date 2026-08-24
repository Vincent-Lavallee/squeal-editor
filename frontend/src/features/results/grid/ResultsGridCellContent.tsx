import type { CellValue } from '../../../../../shared/protocol/index.ts';
import { ForeignKeyIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import CellEditor from '../editing/CellEditor.tsx';

interface Props {
    isEditing: boolean;
    value: CellValue;
    isFk: boolean;
    canNull: boolean;
    columnName: string;
    onCommit: (draft: string) => void;
    onNull: () => void;
    onCancel: () => void;
    onNavigateForeignKey: () => void;
}

export default function ResultsGridCellContent({
    isEditing,
    value,
    isFk,
    canNull,
    columnName,
    onCommit,
    onNull,
    onCancel,
    onNavigateForeignKey,
}: Props) {
    if (isEditing)
        return (
            <CellEditor
                initial={value}
                canNull={canNull}
                onCommit={onCommit}
                onNull={onNull}
                onCancel={onCancel}
            />
        );
    if (value === null)
        return (
            <span data-testid="null-value" style={{ color: t.TEXT_FAINT, fontStyle: 'italic' }}>
                NULL
            </span>
        );
    if (isFk)
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: t.GAP_XS }}>
                {String(value)}
                <button
                    type="button"
                    data-testid="fk-nav"
                    title={`Open the row ${columnName} points at`}
                    style={{
                        flex: 'none',
                        display: 'inline-flex',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        color: t.TEXT_FAINT,
                        cursor: 'pointer',
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onNavigateForeignKey();
                    }}
                >
                    <ForeignKeyIcon
                        style={{ flex: 'none', width: 14, height: 14 }}
                        aria-hidden="true"
                    />
                </button>
            </span>
        );
    return <>{String(value)}</>;
}
