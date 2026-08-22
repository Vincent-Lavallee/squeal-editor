import { useCallback, useEffect, useRef, useState } from 'react';

import type { ResizeEdge } from '../../../../shared/protocol/index.ts';
import { call } from '../../common/bridge/bridge.ts';

/**
 * The window chrome: dragging, maximise state and the window buttons.
 *
 * None of this is store state. `maximized` is read back from the window rather
 * than remembered, and nothing else here outlives the webview.
 *
 * This hook calls the bridge directly instead of going through a thunk, which is
 * the one place in the app that does. A thunk earns its keep by putting a result
 * in a slice and a failure on screen; the frame paint has neither -- it returns
 * nothing to keep and, when the platform says no, there is nothing to tell the
 * user. A slice for it would hold no state.
 */

/**
 * Pixels of travel before a press on the bar counts as a drag.
 *
 * Not a taste value: see `onPointerMove` for why a drag cannot begin on the press
 * itself.
 */
const DRAG_THRESHOLD = 4;

const IS_MACOS = typeof NL_OS !== 'undefined' && NL_OS === 'Darwin';

export function useWindowChrome() {
    const [maximized, setMaximized] = useState(false);
    const [chromeInstalled, setChromeInstalled] = useState(false);

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
     * On macOS neither the WS_THICKFRAME trick nor the frame paint apply. The
     * borderless window there cannot become the key window at all — AppKit
     * refuses keyboard focus to a window without NSWindowStyleMaskTitled — and
     * no JS call can change that. scripts/macos-window-chrome.m, injected by the
     * packaged app's launcher, restyles the window into a titled one with a
     * transparent titlebar, which restores keyboard focus and native resize.
     *
     * See docs/decisions.md before touching either half.
     */
    useEffect(() => {
        if (IS_MACOS) {
            /* Best-effort only: with the injected dylib the window is titled and
             * focuses natively; without it (dev runs) these calls cannot make a
             * borderless window key, but they cost nothing. */
            void Neutralino.window.focus();
            document.getElementById('root')?.focus();

            function onMouseDown(): void {
                void Neutralino.window.focus();
            }
            document.addEventListener('mousedown', onMouseDown);
            return () => document.removeEventListener('mousedown', onMouseDown);
        }
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

    const sync = useCallback(async (): Promise<void> => {
        const isMaximized = await Neutralino.window.isMaximized();
        setMaximized(isMaximized);

        /*
         * Windows maximises a caption-less window over the whole monitor: taskbar
         * covered, resize borders offscreen, and the outermost pixels of the app --
         * the close button, the status bar -- clipped with them. The extension
         * clamps it back onto the work area (see chrome.ts for the measurements).
         *
         * It hangs off sync rather than off our own button because the OS has
         * maximise gestures of its own -- snap-to-top, Win+Up -- and every one of
         * them resizes the webview, which is what brings them all through here.
         * The clamp itself resizes the window once more, so sync runs again; the
         * extension no-ops on a window already fitted, which is what stops that
         * echo from becoming a loop.
         *
         * It is still called unconditionally once the chrome DLL is in, and that is
         * not an oversight: a captioned window is maximised onto the work area by
         * the OS itself, so the clamp measures a window already where it wants it
         * and the same no-op check returns without touching it. Branching on the
         * DLL here would buy one skipped call and cost the guarantee that the
         * window is right whether or not the injection took.
         *
         * macOS has its own native zoom behaviour and does not need this clamp.
         */
        if (isMaximized && !IS_MACOS) {
            await call('window.fitMaximized', { pid: NL_PID }).catch(() => undefined);
        }
    }, []);

    /*
     * The OS owns maximise as much as we do: snapping to the top edge maximises
     * without ever touching our buttons, so the icon has to follow the window
     * rather than our last click. Every one of those paths resizes the webview.
     */
    useEffect(() => {
        void sync();
        globalThis.addEventListener('resize', sync);
        return () => globalThis.removeEventListener('resize', sync);
    }, [sync]);

    const minimize = useCallback((): void => {
        void Neutralino.window.minimize();
    }, []);

    const toggleMaximize = useCallback(async (): Promise<void> => {
        if (await Neutralino.window.isMaximized()) await Neutralino.window.unmaximize();
        else await Neutralino.window.maximize();
        await sync();
    }, [sync]);

    /*
     * app.exit() can go unanswered rather than reject: found on a machine where
     * the install directory was read-only to the unelevated process, its native
     * shutdown path either hung or access-violated, and the window never closed
     * -- silently, because there was nothing here to notice. The race gives it
     * a real deadline and killProcess() as the fallback, and logs so the next
     * one of these is visible in neutralinojs.log instead of just "won't close".
     */
    const close = useCallback((): void => {
        const exited = Neutralino.app.exit().catch(() => undefined);
        const timedOut = new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), 2000),
        );
        void Promise.race([exited, timedOut]).then((result) => {
            if (result !== 'timeout') return;
            void Neutralino.debug
                .log('app.exit() did not complete within 2s; forcing killProcess()', 'ERROR')
                .catch(() => undefined);
            void Neutralino.app.killProcess();
        });
    }, []);

    /*
     * Drag starts on movement, not on pointerdown.
     *
     * beginDrag hands the window to the OS move loop, and that loop swallows the
     * rest of the click -- start it eagerly (as Neutralino's own
     * setDraggableRegion does) and the second press of a double-click never
     * reaches the webview, so double-click-to-maximise silently stops working.
     * Waiting for real travel separates the two: a click stays a click, and a drag
     * still reaches the OS loop, which is what keeps snapping native.
     */
    const origin = useRef<{ x: number; y: number } | null>(null);

    const onPointerDown = useCallback((e: React.PointerEvent): void => {
        if (e.button !== 0) return;
        origin.current = { x: e.screenX, y: e.screenY };
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent): void => {
        const start = origin.current;
        if (!start) return;
        if (Math.hypot(e.screenX - start.x, e.screenY - start.y) < DRAG_THRESHOLD) return;

        // The OS takes the pointer from here, so our pointerup never arrives.
        origin.current = null;
        void Neutralino.window.beginDrag(e.screenX, e.screenY);
    }, []);

    const onPointerUp = useCallback((): void => {
        origin.current = null;
    }, []);

    /*
     * Resize starts on the press, unlike drag.
     *
     * The strips are a dedicated zone rather than a shared one -- a press there
     * can mean nothing else -- so there is no second gesture to tell it apart
     * from, and the travel threshold that keeps a click a click on the bar would
     * only make the window feel stuck to the first few pixels here.
     */
    const beginResize = useCallback((edge: ResizeEdge): void => {
        void call('window.beginResize', { pid: NL_PID, edge }).catch(() => undefined);
    }, []);

    return {
        maximized,
        minimize,
        toggleMaximize,
        close,
        beginResize,
        /**
         * Whether the window lost its top resize border to the injected chrome, and
         * therefore whether the bar has to draw its own grab strips. False on
         * macOS, on a build with no DLL, and any time the injection did not take --
         * in all of which the native border is still there and drawing strips over
         * it would be drawing a second one.
         */
        needsTopResizeStrips: chromeInstalled,
        /** Spread onto whatever area of the bar should move the window. */
        dragProps: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick: toggleMaximize },
    };
}
