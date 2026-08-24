import { useRef } from 'react';
import type { monaco } from '../monaco.ts';

/**
 * The refs `EditorPane` and its sibling hooks share: the host element Monaco
 * mounts into, the live editor instance, the per-tab model and view-state
 * maps, and which tab's model is currently attached. Grouped in one hook so
 * every consumer gets the *same* ref objects rather than each creating its
 * own -- identity here is load-bearing, since effects elsewhere close over
 * these across renders.
 */
export function useEditorRefs() {
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    /*
     * One editor, one model per tab. The model is what makes the text per tab, and
     * swapping it is why nothing here has to write text *into* Monaco: `setModel`
     * is not `setValue`, so the guard that keeps `setValue` from throwing the
     * cursor to the top of the document never comes up. See `docs/decisions.md`.
     */
    const models = useRef(new Map<string, monaco.editor.ITextModel>());
    const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
    const shownTabId = useRef<string | null>(null);

    return { host, editor, models, viewStates, shownTabId };
}
