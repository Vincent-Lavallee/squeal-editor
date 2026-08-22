# Backlog

Added via the `backlog` skill, which grills the idea first — so everything here
is work that survived questioning, not everything anyone thought of.

Four sections, always these four, in this order.

Items name features, never files or functions. Files move; the feature doesn't.

---

## Improvements

Things that already work, but not well enough.

- **The assistant says it is thinking in plain text** — A running query gets
  the thinking orb in the result tabs and the grid, but the assistant's waiting
  state is the bare word `Thinking…` — the same fact about the same app, drawn
  two different ways. Put the orb before the word, in the one moment that is
  genuinely silent: after the turn starts and before any answer text arrives.
  Streaming text is its own evidence of life and does not need it.

- **Naming the conversation leaves a tool row nobody needs** — The assistant
  names its own tab on its first reply, and that call draws a row like every
  other, so the first thing in every thread is the assistant announcing what it
  called itself. The rule that every call leaves a row exists for calls whose
  effect is invisible — a read especially — and this one's effect is the tab
  title changing in front of you. Let a tool declare that it draws no row, the
  way it already declares that it mutates, so the exception is a property beside
  the definition rather than a name the thread happens to skip.

## Bugs

Things that are wrong.

- **A stopped turn leaves the conversation unsendable** — Hitting the tool-call
  cap ends the turn part-way through the model's list of calls, so the ones
  never run get no result, and the notice telling you to ask again is pushed as
  another assistant message right behind them. Every later message replays that
  history and the provider rejects the whole conversation — the thread is dead,
  and the notice invites you to keep using it. Stopping a turn by hand exits at
  the same two points and leaves the same wreck, so the cap is one door out of
  two. Whatever ends a turn early has to answer every call the model made
  first, saying why it was stopped, so the transcript stays well formed and the
  model can read that it ran out of budget rather than being asked to guess.

- **Closing a grid tab discards its staged edits silently** — A browsed grid can
  hold cell edits and row deletes that have not been saved yet, and closing the
  tab throws them away with no warning — while closing an editor tab holding
  unsaved text now asks first. Same loss, same gesture, different answer. The
  reason it was left out is where the staging lives: `ResultsContext`, a feature
  context, where the close is decided in the composition root, so counting them
  means carrying that state across the boundary the feature split exists to keep.
  Whatever the shape, the confirm has to end up one dialog for the whole gesture,
  not one per tab kind.

- **Update ignores custom install path on Windows** — The Windows installer
  lets you choose an install location, but a later update reinstalls to the
  default path instead of the one originally chosen, effectively relocating
  or duplicating the install. The updater needs to read back and respect
  wherever the app is actually installed. The restart after an update now
  reopens the app from wherever it really is, which sharpens this rather than
  softening it: if the install lands somewhere else, the relaunch brings back
  the copy that was not replaced, on the old version, looking like an update
  that silently did nothing.

## Features

Things that do not exist yet.

- **Export a table** — Getting a table out of the app means selecting rows by
  hand or writing the dump query yourself. Add an export that streams a whole
  table — all rows, paged from the server so a large one never has to land in the
  grid first — to a file chosen by a native save dialog, as CSV or as SQL. The
  SQL form is INSERT statements, with the table's `CREATE TABLE` offered as an
  optional preamble that reuses the definition work from the context menu. The
  extension produces the rows, since the UI cannot read a database, and every
  value is emitted exactly as the server sent it, quoted per engine — never
  reformatted through a JS `Date` or `Number`.

- **Say how much context a conversation is holding** — A thread grows a schema,
  a result and every tool answer at a time, and nothing on screen says how heavy
  it has become until a turn fails for being too long. Show the tokens the last
  turn actually sent, per conversation, in the composer footer beside the model
  picker — the model is what the number depends on, so it belongs next to it.
  Both wire formats report usage and neither is read today, so the number
  travels with the turn rather than being counted a second time in the webview.
  It is a bare count and not a fraction: no provider catalog gives a window size
  worth trusting, and the table it would take is one more list that goes stale
  every time a model ships.

- **Light theme** — The design system is Radix dark and nothing else: no token
  has a light value, so the app is dark or it is broken. Give every token a light
  counterpart and somewhere to choose — theme is the first user setting, so it
  brings that screen with it. Three things have to follow the switch, and each
  will otherwise be found by noticing it looks wrong: the editor's theme is built
  once by reading the tokens, the OS window frame is painted `--bg` by the
  extension because Windows draws 7px above the titlebar that no webview can
  reach, and the app icon has the dark plate deliberately baked in.

- **French and English UI** — Every string is English, written where it is used,
  so there is no seam to translate at. Add one, with French beside it and the
  language picked from settings. The rule that has to survive it: chrome is
  translated, data never is. Locale-aware date and number formatting is the
  headline feature of every i18n library and the one thing this app has promised
  not to do — a shifted date and a rounded BIGINT are far worse than an
  untranslated column header.

- **Recent connections** — Show the last 3 connections you actually connected to at the bottom of the connections screen, most recent first. Clicking one connects immediately with the saved credentials.

- **Create a SQLite database** — Connecting to an existing `.db` file works, but
  making a new one still means reaching for another tool first. Add a create path
  to the connect screen: a native save dialog chooses the location, the extension
  opens it with SQLite's create flag, and the connection lands on an empty tree
  that says so rather than looking like a failed load. It is separate from
  connecting because the refusal there is deliberate — a missing file is a failed
  _Connect_ naming it, never a silently conjured empty database — so creating one
  has to be something the user asked for by name.

- **GitHub sync** — Authenticate via browser-based OAuth (no hosted backend) and sync workspaces, connections, and user settings to a private gist automatically on change. Connection passwords are never included in the synced data.

- **Preferences: Settings screen** — The Preferences menu ships with Keyboard
  shortcuts and nothing else, because the Settings item it was meant to sit beside
  would be a screen of placeholders: theme and language are the preferences it
  exists to hold, and neither exists yet. It arrives with whichever of Light theme
  or French/English UI lands first, as that feature's own screen rather than as an
  empty shell waiting for one.

- **Turn off the update banner** — The launch check is silent when it finds
  nothing, but when it finds something the strip is back at every launch and
  dismissing it only lasts the run. Add a remembered preference that stops the
  app raising it on its own. It is about being told, not about the lookup:
  "Check for updates" in the About menu keeps working with the setting off,
  because asking for a check is still asking, and a switch that removed it too
  would leave no way to update at all. It needs the Settings screen, which does
  not exist yet — a second reason to build it, and the first one that is not a
  theme or a language.

- **Command palette** — Every action is reachable exactly one way: a menu, a
  button, or a keybinding you already have to know. Put the common ones behind a
  palette — run, format, switch connection or database, toggle read-only,
  settings, a new tab — along with jumping to a table by name, which is the part
  that earns it a keybinding once a connection holds more tables than a tree is
  pleasant to scroll. Monaco ships its own palette, editor-scoped and live
  today; it is now a registry row on `F1`, so turning it off is unbinding that
  row rather than reaching into Monaco — do that, so there is one. The
  composition root owns it and hands it the commands, because a palette that
  imports every feature is exactly the hub the feature split exists to prevent,
  and whatever key it takes has to be rebound inside the editor too — the way
  running already is — or Monaco eats it first.

- **Linux AppImage release** — Linux ships no release download at all right now
  — the raw zip it used to carry had no desktop integration (no icon in the
  launcher, no .desktop entry, nothing), which was worse than nothing, so it
  was dropped. Wrap the Neutralino binary output in an AppImage with a
  .desktop file and the app icon, so Linux users get the same download-and-run
  experience as the other platforms. AppImage only for now; deb and other
  formats can follow once the format is proven to work.

## Tech debts

Things that should be improved on code wise

- **Continuous integration on pull requests** — Nothing runs on a PR today, so a
  change that breaks the build or a test is only caught when someone runs it
  locally by hand — and the suites that run against real databases are the whole
  safety net this project leans on. Add a pipeline that builds, typechecks, and
  runs the extension suite (real MySQL/Postgres plus the seeded SQLite file) on
  every PR, and the Windows-only UI suite on a Windows runner. Linting joins it
  once a linter is adopted — its own item below.

- **macOS UI test suite** — The UI suite drives the app through WebView2's CDP,
  which exists only on Windows, so on macOS — a supported target — nothing
  exercises the running app and a regression that shows only in the mac webview
  ships unseen. Add a suite that drives the macOS webview the way the Windows one
  drives WebView2, so both platforms the app targets are covered.

- **Contributing guide** — A new contributor has no single place for how the
  project works: the conventions live in the agent working-agreement, the
  architecture in the docs barrel, the testing rules in another doc. Write a
  contributing guide that gives a human one entry point — coding conventions
  (naming, self-describing code, why-not-what comments), the docs-routing
  discipline, how to add an engine, the non-negotiables, and the real-database
  testing requirement.

- **Adopt a linter and formatter** — Style is left to discipline: there is no
  linter or formatter, so nothing mechanically enforces what the conventions ask
  for and drift is only caught by eye in review. Adopt both for what is
  mechanical and wire them into the PR pipeline — this is the linting the CI item
  leaves for later.

- **Strip what-comments** — The codebase carries comments that narrate what the
  code already says, against the standing rule that a comment explains why and
  never what. Do a pass that removes the noise, leaving only the why-comments the
  rule keeps. Can you also update the claude md so that it's more respected
