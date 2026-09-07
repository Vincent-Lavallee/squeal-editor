/**
 * Design tokens — names every colour, size, and radius a component may spend.
 *
 * Lineage: Radix Colors, dark and light. Nearly every value in residual.css
 * lands on a Radix step — #111113 is dark slate-1, #FCFCFD is light slate-1,
 * #E5484D is red-9 in both. Values sampled from the reference UI are used
 * verbatim where they differ slightly from stock Radix (see --border-strong).
 *
 * Colours below are `var(--token)` references, not hex — the hex lives in
 * `residual.css`, one value per theme, because that is the one place a colour
 * is actually *written* now. A token is not only read by CSS — the extension
 * parses one to paint the window frame and Monaco parses several to build its
 * theme, and both do it via `getComputedStyle()` against the CSS custom
 * property, already resolved for whichever theme is active. See
 * `docs/decisions.md` for why the indirection moved here instead of tokens.ts
 * picking the palette itself.
 *
 * The one rule that matters most: THERE IS ONE BACKGROUND. Canvas, sidebar, top
 * bar, cards and table rows are all BG. There is no elevation and there are no
 * shadows. All structure comes from 1px borders and spacing.
 *
 * Second rule: chrome is grayscale. The only non-gray in the chrome is ACCENT
 * (teal) for interactive things. Every other hue is semantic
 * (error/success/warning), never decorative.
 */

/* ---- Surface: one background, borders do the work ---- */

export const BG = 'var(--bg)'; /* slate-1: every surface */
export const BORDER = 'var(--border)'; /* slate-4: panel dividers, table rules */
export const BORDER_STRONG = 'var(--border-strong)'; /* card + input outlines */
export const HOVER = 'var(--hover)'; /* a hint of contrast on the one background */
export const SELECTED = 'var(--selected)'; /* ACCENT at 14% */

/*
 * The dim behind a modal. The one place a shade is allowed: it is not a lighter
 * surface *inside* the app breaking "one background", it is the app itself
 * pushed back so a blocking dialog reads as blocking. Black at 60% in both themes.
 */
export const SCRIM = 'var(--scrim)';

/**
 * The app's own background, thinned, laid over content that is *there but not
 * usable yet* — a saved connection whose AWS profile has not signed in.
 *
 * Not a second surface and not elevation: it sits over the row it obscures
 * rather than under it. SCRIM is the modal's answer to the same shape of
 * question and is deliberately black — that one pushes the whole app back, this
 * one veils one row of it in the app's own colour.
 *
 * Thin because it is not what does the obscuring: VEIL_BLUR is. A wash heavy
 * enough to obscure on its own reads as paint, and the frost is the point.
 */
export const VEIL = 'var(--veil)';
/**
 * What makes the veil read as glass rather than as a flat wash: a hairline along
 * its edges and a sheen down its top half, both contrast at very low alpha —
 * white on the dark theme, black on the light one; either way it is added to
 * the one background, never a second surface underneath it. Same family as
 * HOVER for the same reason.
 */
export const VEIL_EDGE = 'var(--veil-edge)';
export const VEIL_SHEEN = 'var(--veil-sheen)';
/** The far end of the veil, where its label sits and needs a settled ground. */
export const VEIL_DEEP = 'var(--veil-deep)';
/**
 * How hard the frost bites, in px of `backdrop-filter: blur()`. Deep enough that
 * what it covers is unreadable — anything less looks like a mistake rather than
 * a state — which is affordable only because the veil is masked and never
 * reaches the end of the row that says *which* connection this is.
 */
export const VEIL_BLUR = 12;

/**
 * The dot of the relationship diagram's canvas grid.
 *
 * Not a second surface and not a border: it is a *texture* on the one
 * background, and the only thing it means is "this area pans and zooms" -- which
 * is a real fact about the one view that has it, not decoration. Grayscale, so
 * rule 2 holds. Same contrast-at-low-alpha family as HOVER and VEIL_SHEEN, a step
 * up from HOVER because a 4% dot at 24px spacing is invisible and a grid nobody
 * can see is worse than none.
 */
export const CANVAS_DOT = 'var(--canvas-dot)';

/* ---- Text ---- */
export const TEXT = 'var(--text)'; /* slate-12: primary */
export const TEXT_MUTED = 'var(--text-muted)'; /* slate-11: labels, axes, secondary */
export const TEXT_FAINT = 'var(--text-faint)'; /* slate-9: disabled, placeholders */

/* ---- Interactive (the only non-semantic hue) ---- */
export const ACCENT = 'var(--accent)'; /* the one chrome accent, teal in both themes */
export const ACCENT_BG = 'var(--accent-bg)'; /* badge/chip background */
/** Solid accent buttons take this, not a fixed light or dark: see docs/decisions.md. */
export const ON_ACCENT = 'var(--on-accent)';

/*
 * Primary button hover: ACCENT pushed toward the background — brightened on the
 * dark theme, darkened on the light one, since "more contrast against BG" is
 * what a hover means and that points opposite ways in each theme.
 */
export const ACCENT_HOVER = 'var(--accent-hover)';

/* ---- Semantic. Badge pattern is always: step-3 bg + step-11 text ---- */
export const RED = 'var(--red)'; /* red-9: error borders/solids */
export const RED_BG = 'var(--red-bg)'; /* red-3 */
export const RED_TEXT = 'var(--red-text)'; /* red-11 */

export const GREEN = 'var(--green)'; /* green-11: success */
export const GREEN_BG = 'var(--green-bg)'; /* green-3 */

export const AMBER = 'var(--amber)'; /* amber-11: warning */
export const AMBER_BG = 'var(--amber-bg)'; /* amber-3 */

export const PURPLE = 'var(--purple)'; /* purple-11 */
export const PURPLE_BG = 'var(--purple-bg)'; /* purple-3 */

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
 * ---- Connections: which saved connection this one is ----
 *
 * Its own ramp for the same reason --syntax-* was: a connection's identity is
 * not a status. Retuning GREEN for a callout must not repaint a connection that
 * happens to be green. Same Radix step-11 lineage in both themes.
 *
 * Unlike --env-*, this is not an ordered ramp — a connection's colour means
 * nothing but "this one", so the set is a palette to tell one from another, not
 * a pipeline to read down. CONN_SLATE is the neutral default. A workspace
 * carries no colour of its own; see `docs/decisions.md`.
 */
export const CONN_SLATE = 'var(--conn-slate)'; /* the neutral default */
export const CONN_BLUE = 'var(--conn-blue)';
export const CONN_CYAN = 'var(--conn-cyan)';
export const CONN_GREEN = 'var(--conn-green)';
export const CONN_AMBER = 'var(--conn-amber)';
export const CONN_ORANGE = 'var(--conn-orange)';
export const CONN_RED = 'var(--conn-red)';
export const CONN_PINK = 'var(--conn-pink)';
export const CONN_PURPLE = 'var(--conn-purple)';

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
/*
 * The chrome bar height. Every horizontal bar between the titlebar and the
 * status bar is this tall — the tab strip, the sidebar head, the editor
 * toolbar and the connection rail — so the stack reads as one ruled grid
 * rather than four bars that each chose a size. It matches TITLEBAR_H today
 * but is its own fact.
 */
export const TAB_H = 32;
export const STATUSBAR_H = 26; /* bottom status bar */
export const RAIL_H = TAB_H; /* connection rail — full-width horizontal bar */
export const BUTTON_H = 30; /* buttons and inputs */
/*
 * A button sized to sit inside a chrome bar. BUTTON_H against a 32px bar leaves
 * a single pixel either side and reads as the button *being* the bar; this
 * leaves it room to sit in one.
 */
export const BUTTON_H_BAR = 24;

export const ROW_H = 44; /* reference table row height */
/*
 * Deviation from the reference: its 44px rows suit a dashboard table of a
 * dozen rows. A SQL result grid is a data grid — 100 rows at 44px is nothing
 * but scrolling — so grids and the object tree use the dense height instead.
 */
export const ROW_H_DENSE = 30;
/*
 * Tighter still, for a tree row's own detail rows -- a table's expanded columns.
 * These are read as one glance down a short list rather than clicked
 * individually the way a dense row is, so the extra breathing room ROW_H_DENSE
 * gives every tree row is a gap to close here rather than to keep.
 */
export const ROW_H_TIGHT = 22;

export const GAP_XS = 4;
export const GAP_SM = 8;
export const GAP = 12;
export const GAP_LG = 16;
export const GAP_XL = 24;
