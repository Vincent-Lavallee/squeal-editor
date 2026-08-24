import { useEffect } from 'react';
import type { monaco } from '../monaco.ts';

/**
 * Carry a text change made *outside* this editor into the model holding it.
 *
 * This is the one inbound write into a live model, and it exists for one
 * caller: saving a saved query writes the saved text into every other tab open
 * on that query, because they are views of one query rather than copies of it
 * (see `docs/frontend.md`). Seeding at creation cannot serve it -- those models
 * already exist.
 *
 * Three things keep it from being the loop the one-way rule warns about:
 *
 * - **It writes only when the value actually differs.** A keystroke updates
 *   `sqlByTab` from the model, so by the time this runs the two agree and
 *   nothing happens. Without the guard this would fire on every keystroke.
 * - **It applies an *edit*, not `setValue`.** Monaco treats it as a keystroke:
 *   undo still works and the change flows back out through
 *   `onDidChangeModelContent`, so the store stays the one source. `setValue`
 *   would throw the cursor to the top of the document.
 * - **Every model, not just the attached one.** The tab being written to is
 *   usually a background one; its model exists and must be right before it is
 *   ever shown, since the switch effect only attaches a model, never fills it.
 */
export function useSyncInboundSql(
    modelsRef: React.MutableRefObject<Map<string, monaco.editor.ITextModel>>,
    sqlByTab: Record<string, string>,
) {
    useEffect(() => {
        for (const [id, model] of modelsRef.current) {
            const text = sqlByTab[id];
            if (text === undefined || model.getValue() === text) continue;
            model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
        }
    }, [sqlByTab]);
}
