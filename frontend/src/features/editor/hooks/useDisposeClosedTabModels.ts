import { useEffect } from 'react';
import type { Tab } from '../../../store/tabsSlice.ts';
import type { monaco } from '../monaco.ts';

/**
 * Dispose the models of tabs that are gone.
 *
 * Keyed on the tab list rather than hooked to the close button, so that
 * "close others", a disconnect, and whatever closes a tab next all land here
 * for free. Hooking the one handler is how the explorer quietly stopped
 * receiving its database list once already; see `docs/decisions.md`.
 */
export function useDisposeClosedTabModels(
    modelsRef: React.MutableRefObject<Map<string, monaco.editor.ITextModel>>,
    viewStatesRef: React.MutableRefObject<Map<string, monaco.editor.ICodeEditorViewState>>,
    connectionTabs: Tab[],
) {
    useEffect(() => {
        const live = new Set(connectionTabs.map((t) => t.id));
        for (const [id, model] of modelsRef.current) {
            if (live.has(id)) continue;
            model.dispose();
            modelsRef.current.delete(id);
            viewStatesRef.current.delete(id);
        }
    }, [connectionTabs]);
}
