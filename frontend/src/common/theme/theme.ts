/**
 * The theme preference and the value it resolves to.
 *
 * A choice is what the user picked; a resolved theme is what actually gets
 * stamped on the document, since `system` is not itself a palette -- it is an
 * instruction to read one from the OS. Kept apart so nothing downstream (the
 * CSS attribute, Monaco's base, the rail's tints, the window frame paint) has
 * to know `system` exists; every one of them takes a `ResolvedTheme`.
 */
export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_KEY = 'theme';
export const DEFAULT_THEME_CHOICE: ThemeChoice = 'dark';

export function isThemeChoice(value: string): value is ThemeChoice {
    return value === 'dark' || value === 'light' || value === 'system';
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
    if (choice === 'system') return prefersDark ? 'dark' : 'light';
    return choice;
}
