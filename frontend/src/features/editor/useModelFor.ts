import { useCallback } from 'react';
import { monaco } from './monaco.ts';
import type { useLatestEditorState } from './useLatestEditorState.ts';

/** The model a tab's text lives in, creating it the first time it is asked for. */
export function useModelFor(
    modelsRef: React.MutableRefObject<Map<string, monaco.editor.ITextModel>>,
    latest: ReturnType<typeof useLatestEditorState>,
) {
    return useCallback((tabId: string): monaco.editor.ITextModel => {
        const existing = modelsRef.current.get(tabId);
        if (existing) return existing;
        // Seeded from the tab's text if it already has some -- a tab opened *for* a
        // table's definition sets `sqlByTab` before it becomes active, so the model
        // is born holding it. This is the sanctioned way to write the editor from
        // outside: not `setValue` on a live model (which throws the cursor to the top
        // -- see `docs/decisions.md`), but the model's initial content, so the seed
        // and `sqlByTab` agree from the first frame and text still only flows *out*
        // after. A blank query tab has no entry and is born empty, as before.
        //
        // Born in the dialect the engine reported, and kept in it by the effect
        // below -- a tab opened while another is showing must not come back
        // highlighted as plain SQL.
        const created = monaco.editor.createModel(
            latest.current.peekSql(tabId) ?? '',
            latest.current.dialect,
        );
        modelsRef.current.set(tabId, created);
        return created;
    }, []);
}
