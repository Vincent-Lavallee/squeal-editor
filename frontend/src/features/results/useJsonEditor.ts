import { useLayoutEffect, useRef, useState } from 'react';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import { defineTheme, monaco, px, THEME, token } from '../editor/monaco.ts';

/**
 * Creates and disposes the drawer's own Monaco instance, and tracks JSON
 * validity off a plain synchronous `JSON.parse` on every keystroke rather
 * than the worker's async diagnostics -- it is what gates Save, and there is
 * no reason for that gate to lag the worker.
 *
 * Mount only: the drawer exists exactly as long as one cell is being edited
 * (`ResultsTable` renders it conditionally on `jsonEditing`), so a different
 * cell is always a fresh mount, never a prop change to react to.
 */
export function useJsonEditor(host: React.RefObject<HTMLDivElement | null>, initial: CellValue) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const [valid, setValid] = useState(true);
    const [parseError, setParseError] = useState<string | null>(null);

    useLayoutEffect(() => {
        defineTheme();
        const model = monaco.editor.createModel(initial === null ? '' : String(initial), 'json');
        const instance = monaco.editor.create(host.current!, {
            model,
            theme: THEME,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontFamily: token('--mono'),
            fontSize: px('--text-body'),
            lineHeight: Math.round(px('--text-body') * 1.6),
            tabSize: 2,
            renderLineHighlight: 'none',
            padding: { top: px('--gap'), bottom: px('--gap') },
        });
        editorRef.current = instance;

        const validate = () => {
            try {
                JSON.parse(instance.getValue());
                setValid(true);
                setParseError(null);
            } catch (err) {
                setValid(false);
                setParseError(err instanceof Error ? err.message : String(err));
            }
        };
        validate();
        const sub = instance.onDidChangeModelContent(validate);
        instance.focus();

        return () => {
            sub.dispose();
            instance.dispose();
            model.dispose();
            editorRef.current = null;
        };
    }, []);

    return { editorRef, valid, parseError };
}
