import { useEffect } from 'react';

import { call } from '../../../../common/bridge/bridge.ts';
import { useResolvedTheme } from '../../../../common/theme/hooks/useResolvedTheme.ts';
import { IS_MACOS } from './useMacosFocusWorkaround.ts';

/*
 * Repaints the Windows frame -- the ~7px band above the titlebar no webview can
 * reach, see `useFrameChrome` -- whenever the theme changes. `matchWindowFrame`
 * on the extension side has no install guard and stores the colour on the
 * window itself, so calling it again is exactly as safe as calling it once.
 *
 * A plain effect, not a layout one: every layout effect in the tree --
 * including the one that stamps `[data-theme]` on `<html>` -- has already
 * committed by the time any passive effect runs, so `--bg` is guaranteed to
 * already reflect the theme this effect is reacting to, wherever in the tree
 * that stamp happens to live relative to the titlebar.
 */
export function useFrameColour(): void {
    const theme = useResolvedTheme();

    useEffect(() => {
        if (IS_MACOS) return;
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg');
        // Best-effort chrome: a window that keeps its own frame colour is a
        // cosmetic loss, and not something to fail startup or shout about.
        void call('window.matchFrame', { pid: NL_PID, colour: bg.trim() }).catch(() => undefined);
    }, [theme]);
}
