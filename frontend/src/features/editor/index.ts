export { default as EditorPane } from './EditorPane.tsx';
export { useEditor } from './hooks/useEditor.ts';
// Registered once, by the composition root -- see the file comment in
// `useSqlCompletion.ts` for why these aren't `EditorPane`'s to call.
export { useEditorKeybindings } from './hooks/useEditorKeybindings.ts';
export { useSqlCompletion } from './hooks/useSqlCompletion.ts';
export { useSqlFormatter } from './hooks/useSqlFormatter.ts';
