import { useRef } from 'react';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import Drawer from '../../common/components/Drawer.tsx';
import Mono from '../../common/components/Mono.tsx';
import * as t from '../../common/tokens';
import JsonDrawerFooter from './JsonDrawerFooter.tsx';
import { useJsonEditor } from './useJsonEditor.ts';

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
    const { editorRef, valid, parseError } = useJsonEditor(host, initial);

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

            <JsonDrawerFooter
                canNull={canNull}
                valid={valid}
                onNull={onNull}
                onFormat={format}
                onCancel={onCancel}
                onSave={save}
            />
        </Drawer>
    );
}
