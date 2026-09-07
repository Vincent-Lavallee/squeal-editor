import { useSyncExternalStore } from 'react';

import { useStringSetting } from '../../../store/settingsSlice.ts';
import {
    DEFAULT_THEME_CHOICE,
    isThemeChoice,
    resolveTheme,
    THEME_KEY,
    type ResolvedTheme,
} from '../theme.ts';

const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribePrefersDark(onChange: () => void): () => void {
    const query = matchMedia(PREFERS_DARK_QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

function readPrefersDark(): boolean {
    return matchMedia(PREFERS_DARK_QUERY).matches;
}

/**
 * The theme actually in effect: the stored choice, with `system` resolved
 * against the OS. The one hook everything that paints outside CSS -- Monaco,
 * the window frame, the rail's tints -- asks, so `system` only has to be
 * understood in one place.
 *
 * `useSyncExternalStore` rather than a `useEffect` + `useState` pair: the OS
 * preference is external state React does not own, and this is the hook React
 * ships for exactly that -- it also re-renders synchronously with the change,
 * where an effect would lag a frame behind `useThemeAttribute`.
 */
export function useResolvedTheme(): ResolvedTheme {
    const [stored] = useStringSetting(THEME_KEY, DEFAULT_THEME_CHOICE);
    const choice = isThemeChoice(stored) ? stored : DEFAULT_THEME_CHOICE;
    const prefersDark = useSyncExternalStore(subscribePrefersDark, readPrefersDark);
    return resolveTheme(choice, prefersDark);
}
