import { useEffect } from 'react';
import { chordFromEvent, type Bindings } from '../../../common/shortcuts.ts';

/**
 * Run and Save answer from anywhere in the window, matching every other SQL
 * tool. Inside the editor, Monaco's own bindings handle them and stop the
 * event there -- this covers the rest of the window.
 *
 * With a split view there are two of these listeners alive at once, one per
 * pane, and only one pane's Run/Save should answer a keypress that landed
 * outside either Monaco instance -- `focused` is that gate. The Ctrl+S
 * `preventDefault` runs regardless: the OS save dialog is a webview-wide
 * problem, not a per-pane one, so both listeners stopping it is correct,
 * even harmless twice over.
 */
export function useWindowRunSaveFallback(options: {
    onRun: (sql: string) => void;
    onSaveQuery: (() => void) | undefined;
    isEditorTab: boolean;
    sqlToRun: () => string;
    statementToRun: () => string;
    focused: boolean;
    bindings: Bindings;
}) {
    const { onRun, onSaveQuery, isEditorTab, sqlToRun, statementToRun, focused, bindings } =
        options;

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent): void {
            // Prevented whatever Save is currently bound to, and whichever tab is in
            // front: the dialog the webview would otherwise open over the app is
            // Ctrl+S's doing, not this shortcut's, so unbinding or rebinding the
            // shortcut must not hand it back.
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) e.preventDefault();

            const chord = chordFromEvent(e);
            if (chord === null) return;

            const saves = chord === bindings.saveQuery;
            const runsStatement = chord === bindings.runStatement;
            const runsTab = chord === bindings.run;
            if (!saves && !runsStatement && !runsTab) return;

            e.preventDefault();
            if (!focused) return;
            // A grid tab has neither a query to run nor one to save. This pane is
            // still mounted underneath it -- there is one Monaco per pane and every
            // tab's model hangs off it -- so the listener is live and has to refuse
            // for itself.
            if (!isEditorTab) return;

            // The cursor and the selection outlive focus leaving the editor -- Monaco
            // still draws both -- so running from out here means what running from
            // inside it does.
            if (saves) onSaveQuery?.();
            else onRun(runsStatement ? statementToRun() : sqlToRun());
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onRun, onSaveQuery, isEditorTab, sqlToRun, statementToRun, focused, bindings]);
}
