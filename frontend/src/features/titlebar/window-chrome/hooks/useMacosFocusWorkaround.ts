import { useEffect } from 'react';

const IS_MACOS = typeof NL_OS !== 'undefined' && NL_OS === 'Darwin';

/*
 * On macOS neither the WS_THICKFRAME trick nor the frame paint in
 * `useFrameChrome` apply. The borderless window there cannot become the key
 * window at all — AppKit refuses keyboard focus to a window without
 * NSWindowStyleMaskTitled — and no JS call can change that.
 * scripts/macos-window-chrome.m, injected by the packaged app's launcher,
 * restyles the window into a titled one with a transparent titlebar, which
 * restores keyboard focus and native resize.
 *
 * Best-effort only: with the injected dylib the window is titled and focuses
 * natively; without it (dev runs) these calls cannot make a borderless window
 * key, but they cost nothing.
 */
export function useMacosFocusWorkaround(): void {
    useEffect(() => {
        if (!IS_MACOS) return;
        void Neutralino.window.focus();
        document.getElementById('root')?.focus();

        function onMouseDown(): void {
            void Neutralino.window.focus();
        }
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, []);
}

export { IS_MACOS };
