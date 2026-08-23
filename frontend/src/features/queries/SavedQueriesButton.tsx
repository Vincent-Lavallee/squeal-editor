import { useEffect, useRef, useState } from 'react';

import type { SavedQuery } from '../../../../shared/protocol/index.ts';
import { useSavedQueries } from '../../store/savedQueriesSlice.ts';
import { SavedQueryIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import SavedQueriesPanel from './SavedQueriesPanel.tsx';
import { useAutoClose } from './useAutoClose.ts';

const iconSvg = { flex: 'none', width: t.ICON, height: t.ICON };

/**
 * Floating, so it is outlined and never raised -- the rule every menu, popup and
 * find widget in this app follows. Right-aligned to the button, which sits at the
 * strip's trailing edge.
 */
const panel: React.CSSProperties = {
    position: 'absolute',
    zIndex: 50,
    top: t.TAB_H,
    // Inset rather than flush: the button is the last thing before the window's
    // own edge, so `right: 0` puts this popup's outline on the frame. The same 4px
    // `ContextMenu` clamps itself to.
    right: 4,
    display: 'flex',
    flexDirection: 'column',
    width: 260,
    maxHeight: 320,
    overflowY: 'auto',
    padding: t.GAP_XS,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
};

interface Props {
    /** Opening one spans the tabs and the editor, so the shell owns it. */
    onOpen: (query: SavedQuery) => void;
}

/**
 * The way back into a saved query: a button at the right of the tab strip, and
 * the list it drops.
 *
 * It is a sibling of `TabStrip` rather than a control inside it, and that is
 * load-bearing rather than tidy: the strip scrolls horizontally once there are
 * more tabs than fit, and a button inside it would scroll away with them.
 */
export default function SavedQueriesButton({ onOpen }: Props) {
    const { queries, remove } = useSavedQueries();
    const [open, setOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null);

    useAutoClose(root, open, () => setOpen(false));

    // A delete armed on one query must not stay armed for the next time the list
    // is opened, or the second visit shows a Yes/No nobody asked for.
    useEffect(() => {
        if (!open) setConfirmingId(null);
    }, [open]);

    return (
        <div ref={root} style={{ position: 'relative', display: 'flex', flex: 'none' }}>
            <button
                data-testid="saved-queries-open"
                aria-label="Saved queries"
                aria-expanded={open}
                title="Saved queries"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: t.TAB_H,
                    height: t.TAB_H,
                    padding: 0,
                    border: 'none',
                    borderLeft: `1px solid ${t.BORDER}`,
                    borderBottom: `1px solid ${t.BORDER}`,
                    background: 'none',
                    color: open ? t.ACCENT : t.TEXT_MUTED,
                    cursor: 'pointer',
                }}
                onClick={() => setOpen((was) => !was)}
            >
                <SavedQueryIcon style={iconSvg} aria-hidden="true" />
            </button>

            {open && (
                <div data-testid="saved-queries-panel" style={panel} role="menu">
                    <SavedQueriesPanel
                        queries={queries}
                        hoveredId={hoveredId}
                        confirmingId={confirmingId}
                        onHover={setHoveredId}
                        onOpen={(query) => {
                            setOpen(false);
                            onOpen(query);
                        }}
                        onDelete={(id) => {
                            if (confirmingId === id) {
                                remove(id);
                                setConfirmingId(null);
                            } else setConfirmingId(id);
                        }}
                    />
                </div>
            )}
        </div>
    );
}
