import { EditorPane } from '../features/editor/index.ts';
import type { useShell } from './hooks/useShell.ts';
import type { shellPaneView } from './shellPaneView.ts';

interface Props {
    pane: 'primary' | 'secondary';
    s: ReturnType<typeof useShell>;
    view: ReturnType<typeof shellPaneView>;
}

export default function ShellPaneEditor({ pane, s, view }: Props) {
    const { tab, running, onRun, saveQuery, focused, isSecondary } = view;

    return (
        <EditorPane
            tab={tab}
            onRun={onRun}
            running={running}
            commands={s.shellCommands}
            onSaveQuery={saveQuery}
            onExplainSelection={
                s.assistantReady && tab ? (sql) => s.explainSelection(tab, sql) : undefined
            }
            focused={focused}
            exposeGlobal={!isSecondary}
            databases={s.databases}
            onSelectDatabase={(db) => s.pointTabAt(tab, pane, db)}
            pickerOpen={s.pickerPane === pane}
            onPickerOpenChange={(open) => s.setPickerPane(open ? pane : null)}
        />
    );
}
