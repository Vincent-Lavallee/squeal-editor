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

import { HistoryIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import HistoryPanel from './HistoryPanel.tsx';
import { useHistoryPopup } from './hooks/useHistoryPopup.ts';

const buttonStyle = (open: boolean, disabled: boolean): React.CSSProperties => ({
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
});

interface Props {
    tabId: string;
    onOpen: (id: string) => void;
    disabled: boolean;
}

export default function History({ tabId, onOpen, disabled }: Props) {
    const p = useHistoryPopup(tabId, onOpen);

    return (
        <div ref={p.root} style={{ position: 'relative', display: 'flex', flex: 'none' }}>
            {/* Disabled while a turn is in flight: reopening would swap the thread out
          from under a loop that is still writing into it. */}
            <button
                data-testid="ai-history-open"
                aria-label="Past conversations"
                aria-expanded={p.open}
                title={disabled ? 'Finish or stop this turn first' : 'Past conversations'}
                disabled={disabled}
                style={buttonStyle(p.open, disabled)}
                onClick={() => p.setOpen((was) => !was)}
            >
                <HistoryIcon
                    style={{ flex: 'none', width: t.ICON, height: t.ICON }}
                    aria-hidden="true"
                />
            </button>

            {p.open && (
                <HistoryPanel
                    conversations={p.conversations}
                    hoveredId={p.hoveredId}
                    confirmingId={p.confirmingId}
                    onHover={p.setHoveredId}
                    onPick={p.pick}
                    onDeleteClick={p.deleteClick}
                />
            )}
        </div>
    );
}
