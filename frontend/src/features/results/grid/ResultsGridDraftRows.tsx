import { useState } from 'react';
import ResultsGridDraftRow from './ResultsGridDraftRow.tsx';
import type { useResultsGridController } from './hooks/useResultsGridController.ts';

interface Props {
    g: ReturnType<typeof useResultsGridController>;
    columns: string[];
}

export default function ResultsGridDraftRows({ g, columns }: Props) {
    const { inserts, setInsertCell, clearInsertCell, removeInsert, columnWidths } = g;
    const [editing, setEditing] = useState<{ index: number; column: string } | null>(null);

    const commit = (index: number, column: string, draft: string) => {
        const untouched = inserts[index]?.[column] === undefined;
        const leftBlank = draft === '' && untouched;
        if (!leftBlank) setInsertCell(index, column, draft);
        setEditing(null);
    };

    if (inserts.length === 0) return null;

    return (
        <tbody data-testid="draft-rows">
            {inserts.map((values, index) => (
                <ResultsGridDraftRow
                    key={index}
                    columns={columns}
                    columnWidths={columnWidths}
                    values={values}
                    editingColumn={editing?.index === index ? editing.column : null}
                    onStartEdit={(column) => setEditing({ index, column })}
                    onCommit={(column, draft) => commit(index, column, draft)}
                    onNull={(column) => {
                        setInsertCell(index, column, null);
                        setEditing(null);
                    }}
                    onUseDefault={(column) => {
                        clearInsertCell(index, column);
                        setEditing(null);
                    }}
                    onCancelEdit={() => setEditing(null)}
                    onRemove={() => {
                        removeInsert(index);
                        setEditing(null);
                    }}
                />
            ))}
        </tbody>
    );
}
