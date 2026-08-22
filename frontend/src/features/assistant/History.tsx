/**
 * The way back into a conversation already had: a button in the assistant bar,
 * and the list it drops.
 *
 * It reopens **into this tab** rather than minting one, which is the whole of
 * why it needs nothing from the composition root. A tab is a conversation, so
 * pointing this one at a different thread is the tab becoming that conversation
 * — and nothing is destroyed by it, because the thread that was here is itself
 * kept and turns up in this same list. Minting instead would leave the empty tab
 * you opened the picker from sitting beside the one you wanted.
 *
 * **A conversation another tab is holding is listed like any other**, and
 * picking it takes you to that tab instead of loading a second view of it —
 * `reachConversation` is where that decision is made, not here. The list hiding
 * those was the first cut and it read as the feature being broken: a second
 * assistant tab showed a history with the conversation you were just having
 * missing from it.
 */

import { useEffect, useRef, useState } from 'react';

import { DeleteIcon, HistoryIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import { useConversationHistory } from '../../store/assistantSlice.ts';

const iconSvg = { flex: 'none', width: t.ICON, height: t.ICON };

/** Floating, so it is outlined and never raised -- the rule every popup in this app follows. */
const panel: React.CSSProperties = {
    position: 'absolute',
    zIndex: 50,
    top: t.TAB_H,
    right: 0,
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

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Rendered through `Date` deliberately, and it is not the rule being broken:
 * that one forbids putting a value a *server* sent through JS date arithmetic,
 * and this timestamp was minted by our own store for its own ordering.
 */
function ago(updatedAt: number): string {
    const minutes = Math.floor((Date.now() - updatedAt) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export default function History({
    tabId,
    onOpen,
    disabled,
}: {
    tabId: string;
    onOpen: (id: string) => void;
    disabled: boolean;
}) {
    const { conversations, refresh, remove } = useConversationHistory(tabId);
    const [open, setOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null);

    // Read on every open rather than once on mount: a title is written by the
    // model mid-conversation and the dates move as threads are had, so a list
    // fetched at launch is a list of names from before this session started.
    useEffect(() => {
        if (open) refresh();
    }, [open, refresh]);

    // Dismissal is the popup's own, the same listeners `ContextMenu` keeps.
    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: PointerEvent): void {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        }
        function onKeyDown(e: KeyboardEvent): void {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    // A delete armed on one row must not stay armed for the next time the list is
    // opened, or the second visit shows a confirm nobody asked for.
    useEffect(() => {
        if (!open) setConfirmingId(null);
    }, [open]);

    return (
        <div ref={root} style={{ position: 'relative', display: 'flex', flex: 'none' }}>
            {/* Disabled while a turn is in flight: reopening would swap the thread out
          from under a loop that is still writing into it. */}
            <button
                data-testid="ai-history-open"
                aria-label="Past conversations"
                aria-expanded={open}
                title={disabled ? 'Finish or stop this turn first' : 'Past conversations'}
                disabled={disabled}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: t.BUTTON_H_BAR,
                    padding: '0 6px',
                    border: 'none',
                    borderRadius: t.RADIUS,
                    background: 'none',
                    color: open ? t.ACCENT : t.TEXT_MUTED,
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                }}
                onClick={() => setOpen((was) => !was)}
            >
                <HistoryIcon style={iconSvg} aria-hidden="true" />
            </button>

            {open && (
                <div data-testid="ai-history-panel" style={panel} role="menu">
                    {conversations.length === 0 ? (
                        <p
                            style={{
                                margin: 0,
                                padding: `${t.GAP_SM}px 8px`,
                                color: t.TEXT_FAINT,
                                fontSize: t.TEXT_BADGE,
                            }}
                        >
                            No past conversations. The ones you have are kept here when you move on
                            from them.
                        </p>
                    ) : (
                        conversations.map((conversation) => {
                            // Armed counts as shown: the row you are confirming must not lose
                            // its own delete button when the pointer moves off it.
                            const shows =
                                hoveredId === conversation.id || confirmingId === conversation.id;
                            return (
                                <div
                                    data-testid="ai-history-row"
                                    key={conversation.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: t.GAP_XS,
                                        borderRadius: t.RADIUS,
                                        ...(shows ? { background: t.HOVER } : {}),
                                    }}
                                    onMouseEnter={() => setHoveredId(conversation.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                >
                                    <button
                                        data-testid="ai-history-pick"
                                        role="menuitem"
                                        title={conversation.title}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'baseline',
                                            gap: t.GAP_SM,
                                            flex: 1,
                                            minWidth: 0,
                                            padding: '6px 8px',
                                            border: 'none',
                                            background: 'none',
                                            color: t.TEXT,
                                            font: 'inherit',
                                            fontSize: t.TEXT_BODY,
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => {
                                            setOpen(false);
                                            onOpen(conversation.id);
                                        }}
                                    >
                                        <span
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {conversation.title}
                                        </span>
                                        <span
                                            style={{
                                                flex: 'none',
                                                color: t.TEXT_FAINT,
                                                fontSize: t.TEXT_BADGE,
                                            }}
                                        >
                                            {ago(conversation.updatedAt)}
                                        </span>
                                    </button>
                                    {/* Armed by a first click, committed by a second on the same
                      button -- the saved-query row's delete exactly. In flow and
                      always sized, revealed by opacity, so the row never reflows
                      on hover and an invisible delete never sits under the
                      cursor. */}
                                    <button
                                        data-testid="ai-history-delete"
                                        aria-label={
                                            confirmingId === conversation.id
                                                ? `Click again to delete ${conversation.title}`
                                                : `Delete ${conversation.title}`
                                        }
                                        title={
                                            confirmingId === conversation.id
                                                ? 'Click again to delete'
                                                : 'Delete'
                                        }
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flex: 'none',
                                            width: 22,
                                            height: 22,
                                            marginRight: t.GAP_XS,
                                            padding: 0,
                                            border: '1px solid transparent',
                                            borderRadius: t.RADIUS,
                                            background: 'none',
                                            color: t.TEXT_MUTED,
                                            cursor: 'pointer',
                                            opacity: shows ? 1 : 0,
                                            pointerEvents: shows ? 'auto' : 'none',
                                            ...(confirmingId === conversation.id
                                                ? {
                                                      color: t.RED_TEXT,
                                                      background: t.RED_BG,
                                                      borderColor: t.RED,
                                                  }
                                                : {}),
                                        }}
                                        onClick={() => {
                                            if (confirmingId === conversation.id) {
                                                remove(conversation.id);
                                                setConfirmingId(null);
                                            } else setConfirmingId(conversation.id);
                                        }}
                                    >
                                        <DeleteIcon style={iconSvg} aria-hidden="true" />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
