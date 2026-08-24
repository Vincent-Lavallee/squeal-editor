import { useCallback } from 'react';
import type { monaco } from '../monaco.ts';

/**
 * Read and replace the editor's selection, on demand -- the store has never
 * heard of a selection, which is the same reason `sqlToRun` reads it here
 * rather than off anything held in state.
 */
export function useMonacoSelectionActions(
    editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>,
) {
    const selectedText = useCallback((): string => {
        const instance = editorRef.current;
        const range = instance?.getSelection();
        return range && instance ? (instance.getModel()?.getValueInRange(range) ?? '') : '';
    }, []);

    /**
     * Replace whatever is selected -- or insert at the caret when nothing is.
     *
     * Through `executeEdits` rather than `setValue`, so the change leaves as an
     * ordinary edit: one undo step, and `onDidChangeModelContent` carries it to
     * the store like a keystroke. The same trap `setValue` always was.
     */
    const replaceSelection = useCallback((text: string) => {
        const instance = editorRef.current;
        const range = instance?.getSelection();
        if (!instance || !range) return;
        instance.executeEdits('squeal.contextMenu', [{ range, text, forceMoveMarkers: true }]);
        instance.focus();
    }, []);

    return { selectedText, replaceSelection };
}
