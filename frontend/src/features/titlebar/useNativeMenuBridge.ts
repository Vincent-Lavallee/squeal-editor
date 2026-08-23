import { useEffect } from 'react';
import type { useTitlebarDialogs } from './useTitlebarDialogs.ts';

/**
 * The native menu bar at the top of the screen (NSMenuBar) is always present when
 * the app is in the foreground, but Neutralino never populates it — unlike
 * Windows, where File/About live in our own custom titlebar HTML, macOS gets
 * nothing there unless something puts it there. scripts/macos-window-chrome.m
 * builds a literal File/About NSMenu (mirroring Titlebar.tsx's items exactly)
 * and, since clicking a native menu item can't call a React handler directly,
 * evaluates a small JS snippet in the webview that dispatches a `squeal:menu`
 * CustomEvent. This hook is the other end of that pipe.
 */
export function useNativeMenuBridge(options: {
    close: () => void;
    check: (force: boolean) => void;
    openDataDir: () => void;
    onOpenDiagram?: () => void;
    dialogs: ReturnType<typeof useTitlebarDialogs>;
}) {
    const { close, check, openDataDir, onOpenDiagram, dialogs } = options;
    const open = dialogs.open;

    useEffect(() => {
        function onNativeMenu(e: Event): void {
            switch ((e as CustomEvent<string>).detail) {
                case 'exit':
                    close();
                    break;
                case 'environments':
                    open.environments();
                    break;
                case 'exportConnections':
                    open.export();
                    break;
                case 'importConnections':
                    open.import();
                    break;
                case 'shortcuts':
                    open.shortcuts();
                    break;
                case 'relationshipDiagram':
                    onOpenDiagram?.();
                    break;
                case 'checkForUpdates':
                    check(true);
                    break;
                case 'about':
                    open.about();
                    break;
                case 'openDataDir':
                    openDataDir();
                    break;
            }
        }
        window.addEventListener('squeal:menu', onNativeMenu);
        return () => window.removeEventListener('squeal:menu', onNativeMenu);
    }, [close, check, openDataDir, onOpenDiagram, open]);
}
