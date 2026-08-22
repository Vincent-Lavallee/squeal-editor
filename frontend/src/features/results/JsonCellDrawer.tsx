import { useLayoutEffect, useRef, useState } from 'react';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import Button from '../../common/components/Button.tsx';
import Drawer from '../../common/components/Drawer.tsx';
import Mono from '../../common/components/Mono.tsx';
import * as t from '../../common/tokens';
import { defineTheme, monaco, px, THEME, token } from '../editor/monaco.ts';

const header: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    flex: 'none',
    padding: `0 ${t.GAP_LG}px`,
    height: t.TAB_H,
    borderBottom: `1px solid ${t.BORDER}`,
};
const errorBar: React.CSSProperties = {
    flex: 'none',
    padding: `${t.GAP_SM}px ${t.GAP_LG}px`,
    borderBottom: `1px solid ${t.BORDER}`,
    background: t.RED_BG,
    color: t.RED_TEXT,
    fontSize: t.TEXT_BADGE,
    fontFamily: t.MONO,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
};
const footer: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_XS,
    flex: 'none',
    padding: t.GAP_SM,
    borderTop: `1px solid ${t.BORDER}`,
};

interface Props {
    column: string;
    dataType: string | undefined;
    initial: CellValue;
    canNull: boolean;
    onCommit: (draft: string) => void;
    onNull: () => void;
    onCancel: () => void;
}

/**
 * The JSON/JSONB cell editor: a `<Drawer>` rather than the grid's inline
 * `<CellEditor>` popover, because a document wants room a single line does
 * not have. One Monaco instance, created and disposed with the drawer -- it
 * is not the tab editor's singleton, so there is no model map to join; this
 * one model lives exactly as long as the drawer does.
 *
 * Pretty-print is `editor.action.formatDocument`, the same registered action
 * the SQL toolbar's Format button reaches for -- Monaco's own JSON language
 * service backs it (see `features/editor/monaco.ts` for the worker it needs).
 * Validity is tracked separately with a plain `JSON.parse`, synchronously on
 * every keystroke, rather than read off the worker's async diagnostics: it is
 * what gates Save and there is no reason for that gate to lag the worker.
 */
export default function JsonCellDrawer({
    column,
    dataType,
    initial,
    canNull,
    onCommit,
    onNull,
    onCancel,
}: Props) {
    const host = useRef<HTMLDivElement>(null);
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
        // Mount only: the drawer exists exactly as long as one cell is being
        // edited (`ResultsTable` renders it conditionally on `jsonEditing`), so a
        // different cell is always a fresh mount, never a prop change to react to.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const format = () => void editorRef.current?.getAction('editor.action.formatDocument')?.run();
    const save = () => {
        if (valid && editorRef.current) onCommit(editorRef.current.getValue());
    };

    return (
        <Drawer onClose={onCancel}>
            <div style={header}>
                <Mono>{column}</Mono>
                {dataType && (
                    <span style={{ color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>{dataType}</span>
                )}
            </div>

            <div style={{ flex: 1, minHeight: 0 }} ref={host} />

            {parseError && (
                <div data-testid="json-drawer-error" style={errorBar}>
                    {parseError}
                </div>
            )}

            <div style={footer}>
                {canNull && (
                    <Button variant="ghost" onClick={onNull}>
                        Set NULL
                    </Button>
                )}
                <Button variant="ghost" onClick={format} disabled={!valid}>
                    Format
                </Button>
                <div style={{ display: 'flex', gap: t.GAP_XS, marginLeft: 'auto' }}>
                    <Button onClick={onCancel}>Cancel</Button>
                    <Button
                        variant="primary"
                        data-testid="json-drawer-save"
                        onClick={save}
                        disabled={!valid}
                    >
                        Save
                    </Button>
                </div>
            </div>
        </Drawer>
    );
}
