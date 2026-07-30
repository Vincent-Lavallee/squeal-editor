# Design system

Read this before writing any markup. It is small and the rules are strict
on purpose — the look collapses the moment one of them is broken.

Styling lives in four places. There is one CSS file (`residual.css`) for the
handful of things inline styles cannot express; everything else is TypeScript.

| Where | Contains |
|---|---|
| `tokens.ts` | every colour, size, radius. The source of truth. |
| `components/` | reusable primitives that own their styles: `<Button>`, `<Input>`, `<Select>`, `<Checkbox>`, `<Badge>`, `<Modal>`, `<Drawer>`, `<ContextMenu>`, `<Note>`, `<Callout>`, `<Field>`, `<ResizeHandle>`, `<SrOnly>`, `<Mono>` |
| Inline in components | layout and custom styling — every component owns its own layout |
| `residual.css` | CSS custom properties on `:root` (Monaco + the window frame read them at runtime), reset, scrollbars, `::placeholder`, `:focus-visible`, `@keyframes`, `:has()`, and grid compound selectors |

**Never hardcode a colour or size in a component.** If a token is missing, add it
to `tokens.ts`.

**Never export a shared CSS object — make a component.** If you feel the need
to extract a style into a shared object, it is a component. Inline the style
in the JSX; if it repeats across files, it belongs in `components/`. `styles.ts`
existed once and was deleted because CSS-in-JS objects are not components — they
have no name, no props, and no single owner.

The window frame colour still travels across the bridge: `useWindowChrome.ts`
imports `BG` from `tokens.ts` and sends it to the extension. Change `BG` and the
frame follows.
It holds inside the editor as well: Monaco's theme is built by reading these
tokens at startup, not by writing a palette down twice.

**Colours are hex, alpha included (`#669cff24`), never `rgba()`.** A token is not
only read by CSS — the extension parses one to paint the frame and Monaco parses
several to build its theme, and neither speaks `rgba()`. Same colour; this is the
form that travels.

## Lineage

Radix Colors **dark**. Nearly every value is a Radix dark step: `#111113` is
slate-1, `#EDEEF0`/`#B0B4BA` are slate-12/11, `#E5484D` is red-9, `#3DD68C` is
green-11. Values sampled from the reference are used verbatim where they differ
slightly from stock Radix (`--border-strong`).

If the system ever needs full colour scales, `@radix-ui/colors` will drop in
almost exactly. It is not a dependency today because the sampled tokens are
enough and cost nothing.

## The four rules

**1. There is one background.** Canvas, sidebar, toolbar, titlebar, cards, table
rows — all `--bg`. There is no elevation, there are no shadows, and there is no
lighter "card gray". All structure comes from 1px borders (`--border` for
dividers, `--border-strong` for card/input outlines) and from spacing.

This is the rule that makes it look like the reference. Adding a shadow or a
raised surface breaks the system immediately.

`--scrim` and `--veil` are not exceptions to it, and the difference between them
is the whole of when each applies. Neither is a surface *inside* the app: a scrim
pushes the entire app back so a modal reads as blocking, and a veil lies over one
row that is not usable yet so it reads as pending. The scrim is black because it
is the app being dimmed; the veil is `--bg` because it is the app's own colour
laid over its own content. Anything that would be a *lighter* surface **under**
either of them is still forbidden — `--veil-sheen` and `--veil-edge` are light
added *on top*, which is what makes the veil read as glass rather than as a flat
wash, and they are the only place in the system that light is spent this way.

It holds all the way out to the window's edge, but not for free: Windows draws
the window frame itself, in its own colour, and the extension repaints it `--bg`
at startup to keep that true. If the app ever comes up wearing a light band above
the titlebar, that is what has broken — see `decisions.md`.

**2. Chrome is grayscale; colour means something.** The only non-gray in the
chrome is `--accent` (a teal), and only for interactive things (primary button,
active tree row, focus ring, the engine badge). Every other hue is semantic: red = error,
green = success, amber = warning/truncation, purple = a distinct object kind.
Never use colour decoratively. Amber has no use in the chrome today — the badge
it existed for was guessing at truncation and went with the guess — but it stays
a defined kind, because warning is real and `--syntax-number` lands on the step.

Syntax highlighting is not the exception it looks like — it is the rule applied
to *content* rather than chrome, where a colour means "this is a string". It has
its own `--syntax-*` tokens rather than borrowing the semantic ones, because a
string is not a success and a number is not a warning: retuning `--green` for a
callout must never repaint the SQL. They land on the same Radix steps today.

`--conn-*` is the same move for the same reason, and it is the one hue in the
chrome that is neither `--accent` nor semantic. A saved connection's colour is
its *identity*, not a status — it means "this one", which is exactly what the
rail and the saved-connection list tell one connection apart with. Nine
swatches on the Radix dark scale, `--conn-slate` the neutral default; unlike a
ramp their order carries no meaning, they are just a palette to tell one
connection from another. The id-to-hue map lives in `connectionColors.ts` (the
sanctioned data-lookup, like the workspace icon), and it is read by the
connection form's colour picker, the rail, and the saved-connection list's
colour strip. A workspace carries no colour of its own — that identity moved
here outright rather than being merely overridable — see `docs/decisions.md`.

The retired `--env-*` ramp was this same idea for the *environment*, back when
the rail was coloured by which deployment a connection reached. The
environment is a word now — an abbreviation on the rail chip, the full label
in the status bar — because the rail's colour became the connection's own; see
`decisions.md`.

The titlebar's close button going `--red` on hover is not an exception to this:
red is this system's destructive hue and closing is the destructive action. It is
also the platform's convention, so a grayscale close would read as a bug.

**3. There is one bar height.** Every horizontal bar between the titlebar and the
status bar is `--tab-h` (32px): the tab strip, the sidebar head, the editor
toolbar, the connection rail. They stack directly on top of one another, so a bar
that picks its own height reads as a misalignment rather than as a choice — the
rail was 48px and the toolbar 44px, and the stack looked like three unrelated
strips. The titlebar matches at 32px because the platform sets it there, and the
status bar is 26px because it is the one bar that is not part of the stack.

A consequence, and the reason `--button-h-bar` exists: a `--button-h` (30px)
button inside a 32px bar leaves one pixel either side and reads as *being* the
bar. Buttons that live in a bar take the 24px height instead.

**4. The solid accent takes dark text.** `--on-accent`, not white. Dark-on-accent
is the reference's signature (blue there, teal here) and it looks wrong the moment
you use white.

## Two things the browser draws, and neither reads a token

The system is inline styles over tokens, which works right up to the parts of the
page the browser draws for itself. Both of these are in `residual.css` because
neither has an inline equivalent, and both are invisible until they bite.

**`:root { color-scheme: dark }` is what colours everything the browser draws for
itself** — scrollbars, focus rings, autofill, the text-field context menu. None of
them is the app's DOM and none takes CSS; this declaration is the only thing the
palette can be told through.

The dropdown used to be the headline case here: a native `<select>`'s popup
derived its background from the select's own computed `background-color`, so a
`transparent` there — indistinguishable from `--bg` on screen, under rule 1 —
brought the list up on a white canvas. `<Select>` is a hand-rolled listbox now, so
that popup is ordinary app DOM and the trap is gone with it. The general lesson it
taught is not: **where a native widget has to read a colour back, name `--bg` and
do not let it show through.** `color-scheme` is unaffected either way.

**A class rule cannot hide something that sets `display` inline.** Inline styles
outrank any selector, so the grid-tab rule that hid the editor box silently did
nothing to the toolbar beside it, which sets `display: flex` inline like every
other layout in the app. The toolbar stayed up on a grid tab *and* went on
occupying a row in the shell's grid, so the results pane fell into an implicit
row and stopped filling the pane. **If something must be hidden by CSS, it may not
set `display` inline** — and the better answer is usually not to render it: the
editor box is hidden rather than unmounted only because Monaco's models hang off
it, and nothing else in the app has that excuse.

## Recipes

| Building | Do |
|---|---|
| badge / status | `<Badge kind="accent">` from `components/Badge.tsx`. Always pill radius, step-3 background, step-11 text, 12px. Also `kind="green"`, `"red"`, `"amber"`, `"purple"`, `"neutral"`. |
| button | `<Button variant="primary">` / `<Button variant="ghost">` / `<Button>` (default) from `components/Button.tsx`. Each variant owns its own hover state. 6px radius. **It defaults to `type="button"`**, so only the one button that means to submit says `type="submit"` — the HTML default is the other way round, and every Cancel in every form here was quietly submitting it. **A row of buttons is one height**, always `BUTTON_H`: the primary may take `flex: 1` to fill the row, but never a height of its own. Every form and modal here once gave its submit 34px against its siblings' 30, and four pixels is enough to read as two rows of controls that happen to share a line rather than as one set of choices. |
| a wait that is not instant | `<ThinkingOrb state="shaping" size={20} theme="dark">` from the `thinking-orbs` package, beside the phase text of the thing that is actually waiting: `Connecting…` / `Authenticating with AWS…` in `SavedConnectionList` while picking a saved connection, and `Running for {elapsed}s…` in the results bar (`ResultsTable`) while a query runs. Deliberately **not** on a button (`connect-submit`, `run-btn`) — the button already names the state in its own label, and a second busy mark on the control just pressed is noise next to a status line that has none. `theme` is pinned to `"dark"` rather than left `"auto"`: the package resolves light-vs-dark from `prefers-color-scheme` or an ancestor `data-theme`, and this app has neither yet (Radix dark only, no light mode) — `"auto"` would be reading a signal that does not describe this chrome. `state="shaping"` is its dotted-outline circle -> triangle -> square cycle; the other five states are unrelated animations (orbits, globe, rubik, wave, ribbon) this app has no use for. A hand-rolled `clip-path` version, then a hand-rolled `<canvas>` version modelled on this same package's technique, both lived here first — see `decisions.md`. |
| card / panel | Inline: `background: BG, border: 1px solid BORDER_STRONG, borderRadius: RADIUS_LG, padding: GAP_XL`. Never a shadow. |
| section label | `<Field label="…">` from `components/Field.tsx`, or use the `Label` export directly. 11px, uppercase, letter-spaced, `TEXT_MUTED`. |
| identifier / value | `<Mono>` from `components/Mono.tsx`, or inline `fontFamily: MONO`. SQL, column names and cell values are monospace. |
| note | `<Note kind="muted">` / `<Note kind="ok">` / `<Note kind="error">` from `components/Note.tsx`. |
| callout | `<Callout>` from `components/Callout.tsx`. Red border + red background + red text, which is the default because it is nearly always an error. `tone="success"` is the green counterpart (green border + `GREEN_BG` + green text), used by the connect form's *Test* result. The tinted background is the one thing the "one background" rule is not about: it says which *kind* this is, not that the box is raised. |
| modal | `<Modal onClose={…}>` from `components/Modal.tsx`. The one thing that *blocks*: scrim behind, outlined card on top, never a shadow. |
| drawer | `<Drawer onClose={…}>` from `components/Drawer.tsx`. Modal's side-panel sibling: same scrim and outlined `--bg` surface, but pinned to the trailing edge and full height (520px wide) rather than a centered card — for content that wants room, not a sentence. Its one caller today is the JSON cell drawer (`features/results/JsonCellDrawer.tsx`). |
| context menu | `<ContextMenu x= y= items= onClose=>` from `components/ContextMenu.tsx`. Items are data, never children: each caller writes its own labels and disabled rules, and none of them re-implements the chrome. It floats without a scrim because it does not block. Three features summon one — the tree, the grid and the tab strip — which is why it is a primitive and not whichever feature grew it first. |
| form field | `<Field label="…" htmlFor="…" hint="…">` from `components/Field.tsx`. Stacks a `<Label>` over the input with a 5px gap. **The hint slot is also where a field says it is wrong**, in `--red-text`, rather than a message appearing under the control — the label is already there, so the row does not change height and nothing below it moves. Marking a field also puts `borderColor: RED` on its `<Input>`/`<Select>` (the `style` prop is applied last, so it wins over the focus accent) and `aria-invalid` on the control. **Only the exceptions are labelled**: most fields are required, so `(optional)` is the hint worth spending and `(required)` is not. See `docs/frontend.md`, *Saying what is missing*. |
| screen-reader-only | `<SrOnly>` from `components/SrOnly.tsx`. 1px clip, only visible to screen readers. |
| data grid | `<table className="grid">` inside `<div data-testid="grid-scroll">`. The `.grid` class and `.gutter` class must remain on the `<table>` and gutter `<td>`/`<th>` elements — they are the hooks for the compound selectors in `residual.css` (row hover, selected, deleted, dirty, editing states). A column's type trails its name in the header inline; an edited cell wears `className="grid__cell--dirty"`, a selected row `className="grid__row--selected"`, a deleted row `className="grid__row--deleted"`, and the active editor `className="grid__cell--editing"`. The in-place editor is a transparent `<input data-testid="cell-edit-input">` with an accent caret; `data-testid="cell-edit-null"` is the ∅ button for NULL. A JSON/JSONB cell opens the drawer recipe below instead — see `docs/frontend.md`, *The editable grid*. A sortable header carries `className="grid__th--sortable"` (the `--hover` cue, a compound selector like the rest) and the sorted one carries `data-sort="asc"`/`"desc"` plus an accent chevron after the type. An unsorted sortable header carries a `--text-faint` ascending chevron in that same slot with `className="grid__sort-hint"`, hidden by `visibility` until the header is hovered — same slot and `visibility` rather than `display` so the header never changes width, whether hovered or sorted. An unsortable header draws no mark and is left inert rather than styled as disabled — see `docs/frontend.md`, *Sorting by a column header*. |
| save bar | Inline in ResultsTable. Appears only when something is staged (or a save failed): a strip between the results bar and the grid, the change count at one end and ghost **Discard** + primary **Save** at the other, a 1px rule beneath like every bar. |
| filter bar | `features/results/FilterBar.tsx`, above the results bar and only on a grid tab. The one bar whose height is *content*: a CSS grid of fixed tracks, one line per condition (22px controls, 4px gaps), so it is exactly as tall as it has rows. Every row fills the same tracks — lead, column, operator, value, remove — and only the first fills the trailing action cell (`+ / Raw / Apply`); later rows leave those cells empty rather than omitting them, or their controls slide left and the columns stop aligning. The value box is the `1fr` track, so it takes whatever is left and the actions still land at the right edge like the pager beneath them. `+` and `−` are a matched pair — a minus, not a cross, since they add and remove a row rather than dismiss the bar — set larger than the surrounding type with `lineHeight: 1` so the glyph carries the click target without pushing the row taller. The `AND`/`OR` conjunction select is deliberately the one control in the bar that steps *outside* the type scale: 10px, unbolded, `TEXT_FAINT`. It fills its whole lead track with the gap collapsed and padding only on the left (`0 0 0 3px`), because `AND` at 10px plus the `<Select>` caret — a 16px icon, and there is one icon size on purpose — needs every pixel the 52px track has. A literal size rather than a named token, the same call `iconBtn`'s 15px makes, because it answers one binary question under `WHERE` rather than being a value in its own right, and `TEXT_MICRO` is documented as the connection rail's alone. Never grows a second row of buttons: controls that do not fit belong in the results bar. |
| titlebar | Inline in Titlebar. `TITLEBAR_H` (32px), 1px bottom rule. Window buttons are 46px wide because that is the platform's width. |
| menu | The file menu is inline in FileMenu; every context menu is `<ContextMenu>` above. Floating is what earns the `BORDER_STRONG` outline rather than a shadow. Menu items track their own hover state. |
| editor | Monaco, themed in `features/editor/monaco.ts` from these tokens. Style it there, not in CSS — the gutter, the find widget and the scrollbars are its DOM, not ours. The editor div must keep `className="editor"`: it is hidden via `.main--grid .editor { display: none }` in `residual.css` so the single Monaco instance survives grid-tab switches without unmounting. The toolbar above it is simply not rendered on a grid tab — it holds no Monaco state, so there is nothing to preserve, and a class rule could not have hidden it anyway (see below). |
| checkbox | `<Checkbox label="…" hint="…">` from `components/Checkbox.tsx`. A real `<input type="checkbox">` with `appearance: none`, wrapped with its label as one target: the box is 14px with a 3px radius and a 1px `--border-strong` outline, filling `--accent` with an `--on-accent` tick when checked. **Only the paint is taken away, never the input** — focus, Space and the label association are the platform's and must stay so; do not rebuild it out of divs. `accentColor` on a stock checkbox was the previous recipe and is what this replaces: WebView2 and WKWebView each draw the control at their own size, radius and tick shape and honour only the fill, so Windows and macOS wore two different marks for one state. The tick is a **sibling `<span>`, not a `::after`** — Safari renders no pseudo-element on an `<input>` at all, which is the same inconsistency one layer down. |
| select | `<Select>` from `components/Select.tsx` — a trigger plus a floating listbox, drawn as the native element was. **Options are data, not children** (`options={[{ value, label, disabled? }]}` + `onSelect`), the call `ContextMenu` already makes. The popup follows the floating rule: `--bg`, 1px `--border-strong`, never a shadow; the chosen row wears `--selected` + `--accent` and the one under the cursor `--hover`. `searchable` makes **the trigger itself** typeable — **opt-in, and earn it**: a search box over four fixed options is noise, so only the database picker asks for one. `variant="bare"` is the chrome form: no box at rest, semibold, 24px tall, `--text-badge` (12px) rather than the 13px `base` it otherwise inherits — it sits in a bar directly over 12px tree rows, and the mismatch is what "bare" is for — growing a 1px `--border-strong` outline on hover and while open, **deliberately not on focus**: `close()` refocuses the trigger after a pick, so a focus-triggered box would stay lit long after the pointer left it. A keyboard-focused one still rings via the global `:focus-visible` outline — that is the focus affordance here, this box is the hover one. Use it where the select *names* what you are looking at rather than collecting a value. **A control in a bar must be shorter than the bar** — `box-sizing: border-box` means a 32px strip with a 1px rule has 31px of room, so an input-height control overflows it and its box lands on the divider. |
| input | `<Input>` from `components/Input.tsx`. `variant="bare"` is the same chrome form the select has, for the same reason and at the same 24px: no box at rest, a grayscale `--border-strong` outline on hover and focus. The default keeps `--accent` on focus, because in a form focus is a real state and the field is why you are on the screen. |
| tab strip | Inline in TabStrip. `TAB_H` (32px). A tab is a row holding a `<button data-testid="tab-pick">` plus `<button data-testid="tab-close">`, because a `<button>` cannot contain a `<button>`. Divided by 1px rules, never by a surface. Active tab tracked via `aria-selected`. |
| sidebar header | Inline in Sidebar. `TAB_H` (32px), 1px bottom rule, 6px side padding. Holds the database `<Select variant="bare" searchable>`, a ghost refresh `<Button>`, then a ghost `<Button>` for the collapse toggle, last — both boxless at rest, so the strip reads as the tree's title rather than as a toolbar of controls. Right-clicking the picker copies the database name (the file path, for SQLite) without opening it, since there is otherwise no way to copy it besides selecting text out of a query by hand. Confirmation is `<Badge kind="green">` (the same recipe the engine chip uses) holding a checkmark and the word `Copied`, floated under the picker and popped in/out with the `copy-hint-pop` keyframe (`residual.css`) rather than snapping — reads as a small toast rather than a tooltip. It deliberately does not repeat the database name: a SQLite one is a full file path, easily wider than the sidebar, and an earlier version that stretched the hint to fit and ellipsised it was still solving a problem this shorter copy does not have. It self-dismisses after 1.2s (a `hiding` state plays the same keyframe in reverse rather than unmounting outright). |
| sidebar filter | Inline in Sidebar, a second `TAB_H` strip directly beneath the header with its own 1px bottom rule, holding one `<Input variant="bare">`, then a ghost refresh `<Button>`, then the schema group-toggle `<Button>` last (when the engine has schemas). Refresh before the toggle, not after: the header above ends in `[refresh][collapse]`, so putting the *other* toggle-like control (group-by-schema) last here is what lands both refresh icons in the same column instead of one sitting a button-width off. Boxless at rest like the picker above it, so the two strips read as one continuous head rather than as a title with a form stuck under it; its placeholder is what says it can be typed into. |
| connection rail | Inline in ConnectionRail. A full-width horizontal bar (`RAIL_H`, which *is* `TAB_H`) across the top of the shell, above the sidebar and the tabs, with a 1px bottom rule like every other bar. Open connections are grouped by workspace, and a group is one row: the workspace's name and glyph in plain `--text-muted`, then its chips beside them — there is no room to stack a heading over the chips at this height, and groups are told apart by the 1px rule between them. **The heading itself carries no hue** — a workspace has none of its own, only its connections do, so there is nothing to paint it with; see `docs/decisions.md`. Each chip resolves its own tint from `connectionColor(c.color)` (a hex from `tokens.ts`) and spends it directly in inline styles. Every chip hue is a *blend toward `--bg`*, at the three ratios named at the top of the file: a chip's border at 0.3, its wash at 0.07, and the active chip's fill at 0.72. Those numbers are the whole of the rail's volume — it sits above the editor and the results, and full-strength tint there pulls the eye off both. |
| icon | Inline: `flex: none, width: ICON (16), height: ICON (16)` on a glyph from `icons.ts`. Colour is inherited from the surrounding text. Never a `size` or `color` prop. |
| workspace bar | Inline in SavedConnectionList. The outlined row naming the workspace you are in, and the way back to the picker. One control, because one place names a thing. |
| icon picker | Inline in WorkspaceForm. Real `<input type="radio">` per glyph, hidden, with the mark as its face. Same rule as checkbox and select: a single choice from a fixed set is what a radio group *is*. `:focus-visible` is handled by the `:has()` rule in `residual.css`. |
| colour picker | Inline in ConnectionForm's "Color" field, which shares a row with the environment select. The icon picker's shape, spent on a connection's own colour rather than a workspace's — a workspace carries none: a hidden radio per swatch, its face a `<span>` filled with the hex from `connectionColors.ts` (which resolves via `tokens.ts`). No hue is written in the component — it names the token. At rest it is **one 32px tile showing the current hue**; clicking it expands the nine swatches **across the row it already occupies**, and picking one (or the trailing `×`) collapses it back. The tiles are 32px like the select they replace, so the row is exactly as tall in both states and nothing under it moves — the same "the bar is as tall as its content" discipline the filter bar keeps. A floating panel was the alternative and is what "not a dropdown" rules out; see `docs/decisions.md`. `swatch-row-in` (`residual.css`) plays the expansion so it reads as arriving. Focus lives on the hidden radio, so the ring is moved onto the tile by the `.conn-colors__pick:has(input:focus-visible)` rule. The tile carries **`padding: 0`**, which only matters on its `<button>` form (the trailing `×`): a UA-default button padding shrinks the content box the tile centres its glyph in, so the mark lands off-centre in a box that still measures 32px. |
| form section | Inline `Section` in ConnectionForm: a `<Label>` and a 1px `--border` rule running out from it to the card's edge. Names a group of fields — *Server*, *Authentication*, *Options* — without boxing them into a surface of their own, which rule 1 has no room for. Reach for it when a form has enough fields that the reader needs to know which question they are answering; two or three fields do not need one. |
| veiled row | `AwsSignInVeil` in `features/connections/AwsSignIn.tsx`, `data-testid="saved-blocked"`. A row that is *there but not usable yet* — a saved connection whose AWS profile has not signed in. An absolutely positioned pane across the row's click target, revealed on hover/focus, carrying the one action that unblocks it. **Glass, not blur**: `--veil` graded to `--veil-deep` toward the trailing edge, a `--veil-sheen` highlight down the top, a 1px `--veil-edge` hairline top and bottom, and `backdrop-filter: saturate(1.4) brightness(1.08)` — the backdrop *lifted*, never softened. Blurring it was the first cut and it destroyed the one thing the pane has to keep legible: which connection you are being asked to sign in for. **The whole pane is the target**, a `<button>` rather than a button floating inside a `<div>` — the pane is already row-width, and a control centred in it leaves nine tenths of an obviously interactive surface doing nothing. **The label sits at the trailing edge**, where the row has nothing, and the gradient deepens under it; centred it lands on the name and the engine badge. **Dimming the row at rest is what carries the state** (`opacity: 0.5` on the pick target) — with the pane revealed only on hover, a blocked row would otherwise look live right up to the click that does nothing. `pointerEvents` tracks `opacity`, per the hover-reveal rules below, or the invisible pane eats the row's clicks. Cover only what is refused: *Edit* and *Delete* stay reachable, since editing is one of the ways out. Reach for it when an action is *blocked pending one specific step* — never for loading (that is `<Skeleton>`), never for a permanent state (that is a disabled control with a reason). |
| colour strip | Inline in SavedConnectionList, `data-testid="saved-color"`. A 3px `alignSelf: 'stretch'` bar at the left edge of each row, filled from `connectionColor(c.color)` — the same fact the rail's chip spends, read one screen earlier, before the connection is ever opened. |
| status bar | Inline in StatusBar. `STATUSBAR_H` (26px), a 1px top rule like every other bar, one background. Grayscale: it carries the read-only lock (a closed vs open lock, shape not hue) and the active connection's environment as a plain word. |
| resize handle | `<ResizeHandle orientation="vertical" \| "horizontal" onDrag={}>` from `components/ResizeHandle.tsx`. Draws the same 1px `--border` rule the divider would have anyway; the drag target is widened with an invisible absolutely-positioned overlay rather than a thicker visible bar, so it stays a rule at rest — the same "keep the actions in flow" move the hover-reveal rows make, applied to a hit target instead of a control. Reports a raw pixel delta; the caller owns the state, the clamping and which track it feeds. |

**The active tab is `--selected` + `--accent`, the same language as an active tree
row.** There is one background, so it cannot be a lighter surface, and
`--selected` is already this system's word for "this one". *Rejected: the VS Code
bottom-border idiom* — a new visual device for a job the system already has a word
for. Its close button follows the reveal-on-hover recipe below, except that the
**active** tab keeps its close visible: it is the one you are most likely to want
gone.

## Rows that reveal actions on hover

The saved connection list is the pattern. Two rules, both learned the hard way:

- **Keep the actions in flow, do not take them out of it.** They hold their
  space, so revealing them never reflows the row and the text beside them is
  sized for the room that is actually left. The row's label was silently
  ellipsised for exactly this reason.
- **`pointer-events` must track `opacity`.** An invisible button is still a
  clickable one. `opacity: 0` alone leaves an invisible *Delete* under the
  cursor.

Reveal on `:hover` **and** `:focus-within`, or the actions are unreachable by
keyboard.

## The editor

Monaco arrives with a full design system of its own, and the job was making it
wear this one. `features/editor/monaco.ts` is where that happens: it reads the
tokens and defines the theme. Three places the rules had to be enforced against
its defaults, all of which are how it stays part of the app rather than a panel
embedded in it:

- **No lit current line.** `renderLineHighlight: 'none'` — a lit surface is a
  second background. The cursor's line is marked by a brighter line *number*,
  which is text, not a surface.
- **The find widget is outlined, not raised.** Same `--bg`, 1px
  `--border-strong`. It is the menu's situation exactly: the one thing that
  floats is the one thing that gets an outline.
- **The current find match is outlined too.** Every match wears `--selected`;
  the one you are on is told apart by a 1px `--accent` border. Shading it brighter
  would have needed a colour this system does not have.
- **The suggest widget is the find widget's situation exactly.** It floats, so it
  is outlined and not raised: `--bg`, 1px `--border-strong`, and the row you are
  on wears `--selected` — already this system's word for "this one", on a tree
  row and on the active tab. The letters you typed are `--accent` inside each
  label, which is the interactive part of the row and the reason it is in the
  list at all. Verified against the live widget rather than assumed:
  `box-shadow: none`, background `#111113`, border `#363a3f` at 1px.
- **Monaco ships a colour per suggestion kind, and all of them are overridden.**
  A blue field, a purple keyword, an orange function — decorative colour in the
  chrome, landing on hues this palette issues for other meanings entirely. Every
  `symbolIcon.*Foreground` is `--text-muted`: the tree's rule exactly, where the
  glyph is quieter than the name it labels and **shape** is what tells a table
  from a view. That is also what makes the kinds worth setting at all — they are
  picked in `completion.ts` for their marks, not their names.

`inherit: false` is not tidiness — read `decisions.md` before touching it, or
the strings come back red.

## Icons

Remix Icon, bundled. Two rules, and they are the whole of it:

- **Size is set inline from `ICON` (16px), on every glyph.** `width: t.ICON,
  height: t.ICON, flex: 'none'` — never the set's `size` prop, which is a
  hardcoded size in a component. There is one icon size on purpose; if a mark
  looks small, grow the row. **There is no `.icon` class**: an earlier
  `components.css` had one and it is gone, so `className="icon"` sizes nothing
  and the glyph comes out at the set's own 24px — which is how it was found,
  overflowing a 32px tile it was supposed to sit centred in.
- **Colour is inherited, never set.** The icons default to `currentColor`, so an
  icon takes the colour of the text beside it and follows it into hover, `--accent`
  on an active row, `--red` on a destructive one. Recolour the row, not the icon.

The glyphs are `--text-muted` beside `--text` labels — the mark is quieter than
the name it labels — and a caret is `--text-faint`, quieter still.

**Components import a kind, never a glyph.** `src/icons.ts` is the only file that
names `@remixicon/react`; everything else imports `ViewIcon` or `TableIcon` from
it. It must stay one named export per icon — a `Record` of them, or a re-export
of the module, ships all ~3000 instead of the handful actually drawn.

**A new mark is two lines:** add the export to `icons.ts`, use it with
`className="icon"`. If it wants a colour of its own, that is the design being
wrong, not the icon.

### The workspace set is the one lookup, and it is not an exception

`workspaceIcons.ts` maps an id to a glyph and enumerates what may be picked —
which reads like the `Record` the rule above forbids. It is not the thing that
rule is about. **The ban is on a lookup over the icon *package*:** a `Record`
keyed over the 2.4MB barrel, or an `export *`, is what makes all ~3000 glyphs
reachable and ships them. `WORKSPACE_ICONS` is a list over nine glyphs already
imported by name in `icons.ts`, so the bundle holds exactly those nine — which is
the point, since every one of them is pickable.

A lookup is unavoidable here for a reason the chrome's marks never have: **a
workspace's icon is data.** The user chooses it, it is stored as an id and read
back, so something has to turn the id into a drawing and the picker has to
enumerate the choices. The code that draws a table knows at compile time that it
is drawing a table; nothing knows at compile time what a workspace looks like.

It is a list rather than an object because the order *is* the picker's layout, and
an object's key order would be carrying that by accident. `workspaceGlyph` falls
back rather than throwing: the id comes off disk, and a store written by a newer
version must not blank the screen over a mark.

**The set is deliberately disjoint from every kind above**, and that is the design
constraint, not a coincidence — a workspace wearing a table's or a view's glyph
would claim to be the thing it contains. These are also the one place icons are
named after what they *draw* (`RocketIcon`, `LeafIcon`) rather than after a kind,
because they mean nothing on their own: they mean whatever the user's project is.

## Shape

Two radius families, and they are not interchangeable:

- `--radius-pill` — anything status/filter/badge-like.
- `--radius` (6px) buttons and inputs, `--radius-lg` (8px) cards.

## Type

| Token | Use |
|---|---|
| `--text-page` 24px bold | page titles, stat numbers |
| `--text-title` 15px semibold | card titles |
| `--text-body` 13px | body, table cells |
| `--text-badge` 12px | badges, secondary text |
| `--text-label` 11px | uppercase letter-spaced muted labels |
| `--text-micro` 10px | the connection rail only — a compact chrome bar below the general floor; never body copy |

`--font` is Inter with a system fallback. It is **not** loaded from the network —
the app is offline-capable and a desktop app that blocks on a font CDN is a bug.
On Windows it falls back to Segoe UI, which is close enough that the reference
still reads correctly.

## The app icon

A seal, for the pun. `frontend/public/icon.svg` is the source of truth;
`frontend/public/icon.png` (256px) is generated from it and is what the window
and the packaged `.exe` actually use — see `architecture.md` for the wiring and
why the PNG has to exist at all.

**Both files are committed, and nothing regenerates the PNG for you.** Edit the
SVG without re-exporting and the icon silently keeps shipping the old drawing.

It is drawn for **16px**, because Alt-Tab and the taskbar are where it is seen.
That budget is the whole design: one solid mass, no strokes, no interior detail,
two colours. Everything below is what survived drawing it at that size and
looking:

- **The muzzle must be blunt.** A tapered one reads as a beak and the whole thing
  becomes a bird. This is the single strongest cue.
- **The pose is propped-up and horizontal** — head raised, body trailing back.
  Upright reads as a bird; a smooth fusiform body reads as a dolphin.
- **Hind flippers fan at the back.** Without them a seal and a dolphin are the
  same silhouette.
- **A limb only exists if it breaks the outline.** The front flipper hangs below
  the belly on purpose: same-fill shapes *inside* the silhouette are invisible,
  and a gap thin enough to separate them dies at 16px anyway.

Colours are `--bg` for the plate and a fixed `#669cff` blue for the seal,
hardcoded because the file is not CSS and cannot read tokens. The seal's blue no
longer tracks `--accent` — the chrome accent moved to teal and the seal did not
follow, because the committed PNG has no automated regeneration step and the mark
is only ever seen at 16px in the taskbar, never beside the chrome; see
`decisions.md`. The plate is deliberately not coloured and not transparent: at
16px a dark seal on a bright ground turns to mush, and a transparent plate leaves
a light seal invisible on a light background. The seal on near-black is the most
contrast available, which is exactly what 16px needs.

The eye is a `--bg`-filled circle rather than a cut-out, since the plate is
always behind it. It disappears below ~24px. That is expected; the silhouette
carries the mark on its own.

The plate fills the SVG's canvas edge to edge — every consumer of this source
(the Windows window/exe icon, the taskbar) shows it at native size and wants the
full plate. macOS is the one platform that wants an inset, because Dock/Finder
composite their own icons with a content box already built in; that inset is
applied only when `scripts/package-macos.sh` builds `icon.icns`, not in the
source drawing. See `architecture.md`.

## Adapting the reference

The reference described a security dashboard. The visual language transferred;
its domain furniture did not. What happened to each part:

**Adopted as-is** — the flat one-background surface model; the Radix dark
palette; accent-with-dark-text primaries (blue in the reference, teal here); the badge recipe (step-3 bg + step-11
text); pill-vs-6px shape grammar; the type scale; uppercase muted section labels;
monospace for identifiers.

**Adapted**

- *Bar height.* The reference's top bar is 44px, and it has one. This app stacks
  four bars in a column, where four heights read as a misalignment — so they are
  all `--tab-h` (32px) instead, and the 44px value is gone rather than kept as an
  unused token.

- *Row height.* The reference's 44px suits a dashboard table of a dozen rows. A
  SQL result grid is a data grid — 100 rows at 44px is nothing but scrolling — so
  grids and the tree use `--row-h-dense` (30px). `--row-h` still holds the
  reference value. Set `--row-h-dense: var(--row-h)` to follow it exactly.
- *Purple.* Reserved in the reference for "Preview" tags and an AI accent, and
  there is no AI here. Kept as the marker for a distinct object kind, which is
  the same idea one step sideways. If it ever feels decorative, drop it.
- *The icon rail.* Dropped once, on the grounds that this was a two-pane app with
  nothing to navigate. More than one connection can be open now, so there is:
  `.rail` is that component without the flyout, and it moved. It started as a 44px
  icon column at the shell's left carrying a two-letter mark; once it grew to group
  connections by workspace and label each with a full name and environment, it
  became a full-width horizontal bar across the top instead — a column had no room
  for the names without truncating them. The reference's rail navigated a left
  column; this one is a horizontal switcher, the same component taking the shape
  its need actually wants — add the component, then let it grow into that — rather
  than an exception to the rule.

**Dropped** — the critical/high/medium/low severity ramp and its 18px letter
chips (a SQL editor has no severity, and inventing one would be noise); the
floating AI pill; the project switcher and ⌘K search (nothing to switch or
search yet — the palette in the backlog is the ⌘K half arriving); the area charts
(nothing to chart).

If the app grows a use for any of these, the tokens are already consistent with
the reference — add the component, do not redesign. The icon rail is the live
proof that this is the actual procedure and not a comforting note: it came back
when the app grew the need, and it came back as the reference's component.
