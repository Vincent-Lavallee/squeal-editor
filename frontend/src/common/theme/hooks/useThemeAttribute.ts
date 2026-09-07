import { useLayoutEffect } from 'react';

import { useResolvedTheme } from './useResolvedTheme.ts';

/**
 * Stamps the resolved theme onto `<html data-theme>`, which is what
 * `residual.css`'s `[data-theme='light']` block and `color-scheme` selector key
 * off. A layout effect, not a plain one: `useFrameChrome` and Monaco's
 * `defineTheme` both read `--bg` back off this element, and a passive effect
 * would let them run against last render's attribute.
 *
 * Always a concrete value, dark or light, never left unset for `system` --
 * that is also what lets `thinking-orbs`' `theme="auto"` resolve from this same
 * attribute rather than needing to know about the preference itself.
 */
export function useThemeAttribute(): void {
    const theme = useResolvedTheme();
    useLayoutEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);
}
