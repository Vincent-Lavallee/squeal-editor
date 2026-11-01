import type { CellValue } from '../../../../../shared/protocol/index.ts';
import * as t from '../../../common/tokens';
import CellEditor from '../editing/CellEditor.tsx';
import { cellBase, columnSize } from './resultsGridStyles.ts';

interface Props {
    columnName: string;
    width: number | undefined;
    staged: CellValue | undefined;
    isEditing: boolean;
    onStartEdit: () => void;
    onCommit: (draft: string) => void;
    onNull: () => void;
    onUseDefault: () => void;
    onCancelEdit: () => void;
}

const placeholderStyle: React.CSSProperties = { color: t.TEXT_FAINT, fontStyle: 'italic' };

function DraftCellContent({ staged }: Pick<Props, 'staged'>) {
    if (staged === undefined)
        return (
            <span data-testid="draft-default" style={placeholderStyle}>
                default
            </span>
        );
    if (staged === null)
        return (
            <span data-testid="draft-null" style={placeholderStyle}>
                NULL
            </span>
        );
    return <>{String(staged)}</>;
}

export default function ResultsGridDraftCell({
    columnName,
    width,
    staged,
    isEditing,
    onStartEdit,
    onCommit,
    onNull,
    onUseDefault,
    onCancelEdit,
}: Props) {
    const isStaged = staged !== undefined;
    return (
        <td
            data-column={columnName}
            className={[isEditing && 'grid__cell--editing', isStaged && 'grid__cell--dirty']
                .filter(Boolean)
                .join(' ')}
            style={{ ...cellBase, ...columnSize(width) }}
            onClick={isEditing ? undefined : onStartEdit}
        >
            {isEditing ? (
                <CellEditor
                    initial={staged ?? null}
                    canNull
                    onCommit={onCommit}
                    onNull={onNull}
                    onUseDefault={isStaged ? onUseDefault : undefined}
                    onCancel={onCancelEdit}
                />
            ) : (
                <DraftCellContent staged={staged} />
            )}
        </td>
    );
}
