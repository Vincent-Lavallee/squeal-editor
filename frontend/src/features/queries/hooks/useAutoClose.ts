import { useEffect } from 'react';

/**
 * Dismissal is the popup's own, the same listeners `ContextMenu` keeps: a
 * pointer outside its root, or Escape. Nothing else in the app has to know
 * this is open.
 */
export function useAutoClose(
    root: React.RefObject<HTMLDivElement | null>,
    open: boolean,
    close: () => void,
) {
    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: PointerEvent): void {
            if (!root.current?.contains(e.target as Node)) close();
        }
        function onKeyDown(e: KeyboardEvent): void {
            if (e.key === 'Escape') close();
        }
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [root, open, close]);
}
