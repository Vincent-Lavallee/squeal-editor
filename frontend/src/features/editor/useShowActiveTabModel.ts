import { useLayoutEffect } from 'react';
import type { monaco } from './monaco.ts';
import type { useModelFor } from './useModelFor.ts';

/**
 * Show the active tab's model.
 *
 * A layout effect because the pane is `display: none` while a grid tab is
 * showing: `automaticLayout`'s observer has not fired by the time this runs,
 * so the editor still believes it is 0 tall, and a scroll offset restored
 * against a 0-height viewport is silently lost. Measuring first is the fix.
 */
export function useShowActiveTabModel(options: {
    editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>;
    shownTabIdRef: React.MutableRefObject<string | null>;
    viewStatesRef: React.MutableRefObject<Map<string, monaco.editor.ICodeEditorViewState>>;
    activeTabId: string | null;
    isEditorTab: boolean;
    modelFor: ReturnType<typeof useModelFor>;
    setHasSelection: (hasSelection: boolean) => void;
}) {
    const {
        editorRef,
        shownTabIdRef,
        viewStatesRef,
        activeTabId,
        isEditorTab,
        modelFor,
        setHasSelection,
    } = options;

    useLayoutEffect(() => {
        const ed = editorRef.current;
        if (!ed) return;

        // Nothing to show. Detaching matters rather than being tidy: the tab may be
        // closing, and its model is disposed moments later by a separate effect.
        if (!activeTabId || !isEditorTab) {
            ed.setModel(null);
            ed.updateOptions({ placeholder: 'SELECT * FROM …' });
            shownTabIdRef.current = null;
            return;
        }

        const switching = shownTabIdRef.current !== null && shownTabIdRef.current !== activeTabId;
        const model = modelFor(activeTabId);
        ed.setModel(model);
        // Monaco's placeholder widget does not reliably re-evaluate when `setModel`
        // replaces the model with one that already has content, so the grey prompt
        // text can stay visible underneath a pasted definition. Clear it explicitly
        // when the model is non-empty; restore it when the editor is blank.
        ed.updateOptions({
            placeholder: model.getValueLength() > 0 ? undefined : 'SELECT * FROM …',
        });
        ed.layout();

        const saved = viewStatesRef.current.get(activeTabId);
        if (saved) ed.restoreViewState(saved);
        // A tab carries its selection in its view state, so the button has to be
        // told what the tab it just landed on has -- the cursor event fires for
        // edits and clicks, not for a model being swapped underneath it.
        setHasSelection(!(ed.getSelection()?.isEmpty() ?? true));
        // Only when moving between tabs: on the first render this would steal focus
        // from a screen the user has not asked to type into yet.
        if (switching) ed.focus();
        shownTabIdRef.current = activeTabId;

        return () => {
            // On the way out, which includes being hidden for a grid tab -- not only a
            // switch to another editor tab.
            const state = ed.saveViewState();
            if (state) viewStatesRef.current.set(activeTabId, state);
        };
    }, [activeTabId, isEditorTab, modelFor]);
}
