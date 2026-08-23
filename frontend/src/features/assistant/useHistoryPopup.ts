import { useEffect, useRef, useState } from 'react';
import { useConversationHistory } from '../../store/assistantSlice.ts';

/**
 * The history popup's own open/close, dismissal and delete-arming state.
 * Split out of `History` purely for length.
 */
export function useHistoryPopup(tabId: string, onOpen: (id: string) => void) {
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

    function pick(id: string): void {
        setOpen(false);
        onOpen(id);
    }

    function deleteClick(id: string): void {
        if (confirmingId === id) {
            remove(id);
            setConfirmingId(null);
        } else setConfirmingId(id);
    }

    return {
        conversations,
        open,
        setOpen,
        hoveredId,
        setHoveredId,
        confirmingId,
        root,
        pick,
        deleteClick,
    };
}
