import type { TableInfo } from '../../../shared/protocol/index.ts';
import { AssistantPanel } from '../features/assistant/index.ts';
import { RelationshipDiagram } from '../features/diagram/index.ts';
import { ResultsTable } from '../features/results/index.ts';
import Note from '../common/components/Note.tsx';
import * as t from '../common/tokens';
import type { Tab } from '../store/tabsSlice.ts';

interface Props {
    tab: Tab | null;
    showEditor: boolean;
    assistantReady: boolean;
    databases: string[];
    diagramRefreshCount: number;
    pickerOpen: boolean;
    onOpenTable: (table: TableInfo, database?: string | null) => void;
    onSelectDatabase: (database: string) => void;
    onPickerOpenChange: (open: boolean) => void;
    onDiagnose?: (tab: Tab, failure: { sql: string | null; error: string }) => void;
}

export default function ShellPaneBody({
    tab,
    showEditor,
    assistantReady,
    databases,
    diagramRefreshCount,
    pickerOpen,
    onOpenTable,
    onSelectDatabase,
    onPickerOpenChange,
    onDiagnose,
}: Props) {
    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: 'hidden',
                borderTop: showEditor ? undefined : `1px solid ${t.BORDER}`,
            }}
        >
            {tab?.kind === 'assistant' ? (
                <AssistantPanel tabId={tab.id} />
            ) : tab?.kind === 'diagram' ? (
                <RelationshipDiagram
                    tab={tab}
                    onOpenTable={onOpenTable}
                    refreshRequest={diagramRefreshCount}
                    databases={databases}
                    onSelectDatabase={onSelectDatabase}
                    pickerOpen={pickerOpen}
                    onPickerOpenChange={onPickerOpenChange}
                />
            ) : tab ? (
                <ResultsTable
                    tab={tab}
                    onDiagnose={
                        assistantReady && onDiagnose
                            ? (failure) => onDiagnose(tab, failure)
                            : undefined
                    }
                    databases={databases}
                    onSelectDatabase={onSelectDatabase}
                    pickerOpen={pickerOpen}
                    onPickerOpenChange={onPickerOpenChange}
                />
            ) : (
                <Note kind="muted">Nothing open. Click a table, or start a new query.</Note>
            )}
        </div>
    );
}
