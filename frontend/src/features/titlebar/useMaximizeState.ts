import { useCallback, useEffect, useState } from 'react';

import { call } from '../../common/bridge/bridge.ts';
import { IS_MACOS } from './useMacosFocusWorkaround.ts';

/*
 * Windows maximises a caption-less window over the whole monitor: taskbar
 * covered, resize borders offscreen, and the outermost pixels of the app --
 * the close button, the status bar -- clipped with them. The extension
 * clamps it back onto the work area (see chrome.ts for the measurements).
 *
 * It hangs off sync rather than off our own button because the OS has
 * maximise gestures of its own -- snap-to-top, Win+Up -- and every one of
 * them resizes the webview, which is what brings them all through here. The
 * clamp itself resizes the window once more, so sync runs again; the
 * extension no-ops on a window already fitted, which is what stops that echo
 * from becoming a loop.
 *
 * It is still called unconditionally once the chrome DLL is in, and that is
 * not an oversight: a captioned window is maximised onto the work area by the
 * OS itself, so the clamp measures a window already where it wants it and
 * the same no-op check returns without touching it. Branching on the DLL
 * here would buy one skipped call and cost the guarantee that the window is
 * right whether or not the injection took.
 *
 * macOS has its own native zoom behaviour and does not need this clamp.
 */
export function useMaximizeState() {
    const [maximized, setMaximized] = useState(false);

    const sync = useCallback(async (): Promise<void> => {
        const isMaximized = await Neutralino.window.isMaximized();
        setMaximized(isMaximized);
        if (isMaximized && !IS_MACOS) {
            await call('window.fitMaximized', { pid: NL_PID }).catch(() => undefined);
        }
    }, []);

    // The OS owns maximise as much as we do: snapping to the top edge maximises
    // without ever touching our buttons, so the icon has to follow the window
    // rather than our last click. Every one of those paths resizes the webview.
    useEffect(() => {
        void sync();
        const onResize = () => void sync();
        globalThis.addEventListener('resize', onResize);
        return () => globalThis.removeEventListener('resize', onResize);
    }, [sync]);

    const toggleMaximize = useCallback(async (): Promise<void> => {
        if (await Neutralino.window.isMaximized()) await Neutralino.window.unmaximize();
        else await Neutralino.window.maximize();
        await sync();
    }, [sync]);

    return { maximized, toggleMaximize };
}
