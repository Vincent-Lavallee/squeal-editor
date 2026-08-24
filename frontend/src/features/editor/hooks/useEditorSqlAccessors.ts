import { useCallback } from 'react';
import { statementAt } from '../../../common/db/splitStatements.ts';
import type { monaco } from '../monaco.ts';
import type { useLatestEditorState } from './useLatestEditorState.ts';

/**
 * What every way of running the editor reads: the whole tab or the one
 * statement the cursor is in, both taken from Monaco directly rather than
 * from React state.
 */
export function useEditorSqlAccessors(
    editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>,
    latest: ReturnType<typeof useLatestEditorState>,
) {
    /*
     * What every way of running runs: the selection when there is one, the whole
     * tab otherwise. Read off Monaco at the moment of the run rather than tracked
     * in state -- a selection is Monaco's and the store has never heard of it, so
     * there is nothing to keep in step.
     *
     * A selection of nothing but whitespace runs *nothing*, and does so by being
     * passed along: `runQuery` already refuses a blank statement, which is the same
     * no-op an empty editor gets. Falling back to the whole tab there would run the
     * text the user had just narrowed away from.
     */
    const sqlToRun = useCallback((): string => {
        const model = editorRef.current?.getModel();
        const selection = editorRef.current?.getSelection();
        if (!model || !selection || selection.isEmpty()) return latest.current.sql;
        return model.getValueInRange(selection);
    }, []);

    /*
     * What Ctrl+Shift+Enter runs: the one statement the cursor is standing in.
     *
     * **A selection is ignored, deliberately.** This key means "the statement I am
     * in" and nothing else, so it stays worth pressing while text happens to be
     * selected; Ctrl+Enter is the one that honours a selection, and two keys that
     * do the same thing whenever a selection exists would be one key too many.
     * `getPosition` is the cursor itself, which is the active end of a selection
     * rather than some third thing to reconcile.
     *
     * The text is read off the model rather than off `latest.current.sql` because
     * the offset is an index *into that string*: the two agree, since text only
     * flows out of Monaco, but reading one and indexing the other would be a bet
     * on that rather than a use of it.
     *
     * Nothing to run comes back as `''` and is passed along rather than branched
     * on -- `runQuery`'s own condition refuses a blank statement, the same no-op
     * an empty editor and a whitespace-only selection already get.
     */
    const statementToRun = useCallback((): string => {
        const model = editorRef.current?.getModel();
        const position = editorRef.current?.getPosition();
        if (!model || !position) return '';
        return (
            statementAt(model.getValue(), latest.current.dialect, model.getOffsetAt(position)) ?? ''
        );
    }, []);

    return { sqlToRun, statementToRun };
}
