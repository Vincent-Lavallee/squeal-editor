import { useCallback } from 'react';
import type { ShortcutId } from '../../../common/shortcuts.ts';
import type { monaco } from '../monaco.ts';
import type { useLatestEditorState } from './useLatestEditorState.ts';

/**
 * What a shortcut does, whichever way it arrived. The three the editor owns
 * are answered here because only this pane can say what its own text and
 * cursor are; everything else is the shell's, and is passed through.
 *
 * Read off `latest.current` rather than closed over, so this stays stable
 * while the handlers behind it change every render -- the Monaco actions
 * registered against it must not be re-registered per keystroke.
 */
export function useRunShortcut(
    editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>,
    latest: ReturnType<typeof useLatestEditorState>,
    sqlToRun: () => string,
    statementToRun: () => string,
) {
    const runShortcut = useCallback(
        (id: ShortcutId): void => {
            const { onRun, onSaveQuery, commands } = latest.current;
            if (id === 'run') {
                onRun(sqlToRun());
                return;
            }
            if (id === 'runStatement') {
                onRun(statementToRun());
                return;
            }
            if (id === 'saveQuery') {
                onSaveQuery?.();
                return;
            }
            commands?.[id]?.();
        },
        [sqlToRun, statementToRun],
    );

    // The button is the same action the shortcut and the context menu run, not a
    // second path into the formatter: reach for Monaco's registered action rather
    // than calling the provider directly, so the three stay one thing.
    const format = useCallback(() => {
        void editorRef.current?.getAction('editor.action.formatDocument')?.run();
    }, []);

    return { runShortcut, format };
}
