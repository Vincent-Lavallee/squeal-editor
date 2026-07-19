/**
 * Design tokens — the one source of truth for every colour, size, and radius.
 *
 * Lineage: Radix Colors *dark*. Nearly every value below lands on a Radix dark
 * step — #111113 is slate-1, #EDEEF0/#B0B4BA are slate-12/11, #E5484D is red-9,
 * #3DD68C is green-11. Values sampled from the reference UI are used verbatim
 * where they differ slightly from stock Radix (see --border-strong).
 *
 * Colours are hex (#RRGGBBAA), never rgba(). A token is not only read by CSS —
 * the extension parses one to paint the frame and Monaco parses several to build
 * its theme, and neither speaks rgba(). Same colour; this is the form that travels.
 *
 * The one rule that matters most: THERE IS ONE BACKGROUND. Canvas, sidebar, top
 * bar, cards and table rows are all BG. There is no elevation and there are no
 * shadows. All structure comes from 1px borders and spacing.
 *
 * Second rule: chrome is grayscale. The only non-gray in the chrome is ACCENT
 * (teal) for interactive things. Every other hue is semantic
 * (error/success/warning), never decorative.
 *
 * These values mirror tokens.css for the benefit of inline styles. CSS custom
 * properties must still exist at runtime — Monaco's theme and the window frame
 * paint read them via getComputedStyle().
 */

/* ---- Surface: one background, borders do the work ---- */

export const BG = '#111113'; /* slate-1: every surface */
export const BORDER = '#272a2d'; /* slate-4: panel dividers, table rules */
export const BORDER_STRONG = '#363a3f'; /* card + input outlines */
export const HOVER = '#ffffff0a'; /* white at 4% */
export const SELECTED = '#0eb39e24'; /* ACCENT at 14% */

/*
 * The dim behind a modal. The one place a shade is allowed: it is not a lighter
 * surface *inside* the app breaking "one background", it is the app itself
 * pushed back so a blocking dialog reads as blocking. Hex-with-alpha — black at 60%.
 */
export const SCRIM = '#00000099';

/* ---- Text ---- */
export const TEXT = '#edeef0'; /* slate-12: primary */
export const TEXT_MUTED = '#b0b4ba'; /* slate-11: labels, axes, secondary */
export const TEXT_FAINT = '#696e77'; /* slate-9: disabled, placeholders */

/* ---- Interactive (the only non-semantic hue) ---- */
export const ACCENT = '#0eb39e'; /* teal-10: the one chrome accent */
export const ACCENT_BG = '#0d2d2a'; /* teal-3: badge/chip background */
export const ON_ACCENT = '#0d1514'; /* teal-1: solid accent buttons take DARK text */

/*
 * Primary button hover: ACCENT brightened toward white (color-mix 85%).
 * Pre-computed so inline styles never need a color-mix() polyfill.
 */
export const ACCENT_HOVER = '#24baa7';

/* ---- Semantic. Badge pattern is always: step-3 bg + step-11 text ---- */
export const RED = '#e5484d'; /* red-9: error borders/solids */
export const RED_BG = '#3b1219'; /* red-3 */
export const RED_TEXT = '#ff9592'; /* red-11 */

export const GREEN = '#3dd68c'; /* green-11: success */
export const GREEN_BG = '#132d21'; /* green-3 */

export const AMBER = '#ffca16'; /* amber-11: warning */
export const AMBER_BG = '#341c00'; /* amber-3 */

export const PURPLE = '#bf7af0'; /* purple-11 */
export const PURPLE_BG = '#301c3b'; /* purple-3 */

/*
 * ---- Syntax: the one place colour describes content, not chrome ----
 *
 * The rule above still holds — these mean something, and what they mean is
 * "this is a string", "this is a keyword". They are separate tokens rather than
 * re-used semantic ones because a string is not a success and a number is not a
 * warning: retuning GREEN for a callout must not repaint the SQL.
 * Same Radix dark lineage, so they land on the same steps today.
 */
export const SYNTAX_KEYWORD = ACCENT;
export const SYNTAX_STRING = GREEN;
export const SYNTAX_NUMBER = AMBER;
export const SYNTAX_COMMENT = TEXT_FAINT;
export const SYNTAX_PUNCTUATION = TEXT_MUTED;

/*
 * ---- Workspaces: whose project a connection belongs to ----
 *
 * Its own ramp for the same reason --syntax-* was: a workspace's identity is
 * not a status. Retuning GREEN for a callout must not repaint a workspace that
 * happens to be green. Same Radix dark lineage (~step-11).
 *
 * Unlike --env-*, this is not an ordered ramp — a workspace's colour means
 * nothing but "this project", so the set is a palette to tell one from another,
 * not a pipeline to read down. WS_SLATE is the neutral default.
 */
export const WS_SLATE = '#b0b4ba'; /* slate-11: the neutral default */
export const WS_BLUE = '#5eb0ef'; /* blue-11 */
export const WS_CYAN = '#4ccce6'; /* cyan-11 */
export const WS_GREEN = '#3dd68c'; /* green-11 */
export const WS_AMBER = '#ffca16'; /* amber-11 */
export const WS_ORANGE = '#ffa057'; /* orange-11 */
export const WS_RED = '#ff9592'; /* red-11 */
export const WS_PINK = '#ff8dcc'; /* pink-11 */
export const WS_PURPLE = '#bf7af0'; /* purple-11 */

/* ---- Shape: pills for status, 6-8px for everything else ---- */
export const RADIUS_PILL = 999; /* badges, chips, filter controls, search */
export const RADIUS = 6; /* buttons, inputs */
export const RADIUS_LG = 8; /* cards, panels */

/* ---- Type ---- */
export const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace';

export const TEXT_PAGE = 24; /* page titles, stat numbers — bold */
export const TEXT_TITLE = 15; /* card titles — semibold */
export const TEXT_BODY = 13; /* body, table cells */
export const TEXT_BADGE = 12; /* badges, secondary */
export const TEXT_LABEL = 11; /* uppercase section labels, letter-spaced, muted */
export const TEXT_MICRO = 10; /* the connection rail only — never body copy */

export const TRACKING_LABEL = '0.04em';

/*
 * ---- Icons ----
 *
 * One size, because there is one kind of icon: a 16px mark beside 13px text.
 * The set draws every glyph on a 24px canvas with its own padding, so this is
 * the canvas, not the ink — the drawing inside lands around 10-11px, which is
 * why it sits beside TEXT_BODY without shouting over it.
 */
export const ICON = 16;

/* ---- Density ---- */
export const TITLEBAR_H = 32; /* Windows' own titlebar height */
export const BAR_H = 44; /* top bar */
export const TAB_H = 32; /* tab strip — matches TITLEBAR_H today but is its own fact */
export const STATUSBAR_H = 26; /* bottom status bar */
export const RAIL_H = 48; /* connection rail — full-width horizontal bar */
export const ROW_H = 44; /* reference table row height */
/*
 * Deviation from the reference: its 44px rows suit a dashboard table of a
 * dozen rows. A SQL result grid is a data grid — 100 rows at 44px is nothing
 * but scrolling — so grids and the object tree use the dense height instead.
 */
export const ROW_H_DENSE = 30;

export const GAP_XS = 4;
export const GAP_SM = 8;
export const GAP = 12;
export const GAP_LG = 16;
export const GAP_XL = 24;
