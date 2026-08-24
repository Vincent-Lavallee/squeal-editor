import { useEffect, useState } from 'react';

import { call } from '../../../../common/bridge/bridge.ts';
import { IS_MACOS } from './useMacosFocusWorkaround.ts';

/*
 * Two halves of one idea: keep the OS frame, stop it looking like the OS frame.
 *
 * Neutralino's borderless mode is `style & ~(WS_CAPTION | WS_THICKFRAME)`, and
 * Windows hangs *both* edge-resize and Aero Snap off WS_THICKFRAME -- a window
 * without it cannot be snapped, because Windows only snaps windows it believes
 * are sizeable. Borderless alone therefore trades the titlebar for a window you
 * cannot snap or resize, which is the whole trap this feature exists to avoid.
 * setSize is the only public API that puts the bit back, and it reads as a
 * no-op: it sends the size the window already has, and `resizable` is the point.
 *
 * Keeping the frame means Windows draws ~7px of it above our titlebar, in the
 * non-client area no webview can paint. So the extension paints it: it is the
 * process that can make the native calls we cannot. The colour comes from
 * tokens.css rather than being written twice, and the pid has to be sent
 * because Neutralino spawns extensions through a shell -- the extension's own
 * parent is that shell, not this window.
 *
 * `installChrome` is what removes that band instead of recolouring it, and
 * what gives the window back the minimise and maximise animations Windows
 * hangs off WS_CAPTION. It is a third call rather than part of either of the
 * two above because it happens somewhere else entirely: a DLL injected into
 * the app process, since WM_NCCALCSIZE is answered by the window's own thread
 * and by nothing else. Every call here stays, in this order, because a build
 * without that DLL -- no C compiler on the machine that made it -- is still a
 * build that has to draw a window.
 *
 * See docs/decisions.md before touching either half.
 */
export function useFrameChrome(): boolean {
    const [chromeInstalled, setChromeInstalled] = useState(false);

    useEffect(() => {
        if (IS_MACOS) return;
        void (async () => {
            await Neutralino.window.setSize({ resizable: true });

            /*
             * Re-adding WS_THICKFRAME insets the client area by the resize border
             * (7px a side), but the webview child keeps the full-window size it was
             * created at -- so the right and bottom ~14px of the app, the close
             * button and the status bar among them, sit clipped behind the frame
             * until a real resize makes Neutralino refit it. Nothing but an actual
             * size change triggers that refit, so cause one: a pixel out and back.
             * Both calls keep `resizable` on -- that option is what holds
             * WS_THICKFRAME itself, and a bare setSize would drop it.
             */
            const { width, height } = await Neutralino.window.getSize();
            await Neutralino.window.setSize({ width: width + 1, height, resizable: true });
            await Neutralino.window.setSize({ width, height, resizable: true });

            const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg');
            // Best-effort chrome: a window that keeps its own frame colour is a
            // cosmetic loss, and not something to fail startup or shout about.
            await call('window.matchFrame', { pid: NL_PID, colour: bg.trim() }).catch(
                () => undefined,
            );

            /* Last, because it is the one that changes the client area: the nudge
             * above has to have happened against the frame the window started with.
             * The answer decides whether the grab strips are drawn -- they replace
             * the top resize border, which only goes away if this applied. */
            const chrome = await call('window.installChrome', { pid: NL_PID }).catch(() => ({
                applied: false,
            }));
            setChromeInstalled(chrome.applied);
        })();
    }, []);

    return chromeInstalled;
}
