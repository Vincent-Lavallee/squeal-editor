import { useCallback } from 'react';

import type { ResizeEdge } from '../../../../shared/protocol/index.ts';
import { call } from '../../common/bridge/bridge.ts';
import { useFrameChrome } from './useFrameChrome.ts';
import { useMacosFocusWorkaround } from './useMacosFocusWorkaround.ts';
import { useMaximizeState } from './useMaximizeState.ts';
import { useWindowDrag } from './useWindowDrag.ts';

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
 *
 * Composed from four narrower hooks, each its own file: `useMacosFocusWorkaround`,
 * `useFrameChrome` (the OS frame paint and the injected chrome DLL),
 * `useMaximizeState` and `useWindowDrag`.
 */
export function useWindowChrome() {
    useMacosFocusWorkaround();
    const chromeInstalled = useFrameChrome();
    const { maximized, toggleMaximize } = useMaximizeState();
    const { onPointerDown, onPointerMove, onPointerUp } = useWindowDrag();

    const minimize = useCallback((): void => {
        void Neutralino.window.minimize();
    }, []);

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
