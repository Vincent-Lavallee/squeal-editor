# Squeal Editor — working agreement

A stupid simple multi-database SQL editor. Neutralino shell, React UI, and a
Bun + TypeScript extension that owns the database connections.

## Before you start a task

**Read `docs/README.md` first.** It is a barrel index: a routing table that maps
the kind of change you are making to the one or two docs you actually need. Load
only those. The docs are split precisely so you never have to page the whole
project into context.

Do not skim the code to rebuild context the docs already carry — especially the
non-obvious constraints, which look like arbitrary choices until you know why
they exist and which have already been reverted-and-rediscovered once.

## After you finish a task

**Update the docs you invalidated, in the same change.** Concretely:

- Behaviour or structure changed → update that area's doc.
- A decision was made or reversed → add or amend the entry in `docs/decisions.md`.
- A new invariant emerged (something that will silently break if violated) →
  write it down where a future reader would look for it, not where you found it.
- The routing table in `docs/README.md` is wrong or a doc was added → fix it.

Docs describe the current state. Do not write changelog entries ("previously we
used X"), except in `docs/decisions.md`, which is explicitly a record of _why_
and is allowed to name what was rejected.

If a task teaches you something surprising, that is exactly the thing worth
writing down. If nothing changed conceptually, change nothing.

## Commands

|                      |                                                             |
| -------------------- | ----------------------------------------------------------- |
| `bun install`        | deps for all workspaces + fetches the Neutralino binaries   |
| `bun start`          | build the frontend, then launch the app                     |
| `bun run build`      | build the frontend into `resources/`                        |
| `bun run typecheck`  | typecheck frontend + extension                              |
| `bun run lint`       | ESLint over the whole repo                                   |
| `bun run format`     | Prettier, writes in place                                    |
| `bun run knip`       | find files nothing imports                                   |
| `bun run test:db:up` | start throwaway MySQL + Postgres in Docker                  |
| `bun test`           | extension suite (needs the test databases; UI suite skips)  |
| `bun run test:ui`    | drive the real app (Windows-only, needs the test databases) |

## Non-negotiables

These are load-bearing. Each one cost real debugging; see `docs/decisions.md`.

1. **The UI never opens a database connection.** Neutralino's runtime cannot.
   All database work happens in the extension, over the bridge.
2. **Never render a database value through JS `Date` or `Number`.** Dates get
   timezone-shifted and BIGINTs silently round. Show what the server sent.
3. **One background colour.** No shadows, no elevation, no lighter "card gray".
   Structure comes from 1px borders only.
4. **The extension must not outlive the app.** It heartbeats; do not remove it
   on the assumption that closing a socket is enough.
5. **Verify against a real database.** Every bug found so far was invisible to a
   mock. `bun test` is not optional before claiming something works.

## Rules

- Never, ever add yourself as a co-author.
- Avoid comments if possible. Code should be self describing (eg Name variables appropriately. Extract if conditions into variables for easier understanding.). So avoid JSDOC at all cost and make the core more self readable
- Never commit by yourself unless asked to
- Run `bun run lint` / `bun run format` before calling a change done; see
  `docs/decisions.md` for what each rule enforces and why. The 200-line file /
  60-line function caps are errors but the repo isn't clean against them yet —
  that cleanup is its own pass, so a violation in a file you didn't touch isn't
  yours to fix.
