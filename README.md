# Squeal Editor

A stupid simple multi-database SQL editor. Neutralino + React + TypeScript, with
MySQL and PostgreSQL support.

Browse databases and tables in a sidebar, click a table to preview it, or write
SQL by hand and run it.

## Running it

```bash
bun install     # all workspaces + fetches the Neutralino binaries
bun start       # builds the frontend and launches the app
```

**Bun must be on your PATH** — the app shells out to it to run the database
extension. That is the tradeoff for a ~2MB app instead of Electron's ~150MB.

## How it fits together

Neutralino's runtime is a webview plus a small native binary, with no JS engine
that can open a TCP socket. So the UI *cannot* talk to a database. The database
work lives in a **Neutralino extension**: a Bun + TypeScript process that
Neutralino spawns and reaches over a WebSocket. Bun runs the TypeScript directly,
so the extension has no build step.

```
frontend/          React + Vite → builds into resources/
extensions/db/     the process that actually holds the DB connections
shared/protocol.ts the typed contract between them
tests/             real-database + real-app suites
```

## Documentation

Start at **[docs/README.md](docs/README.md)** — a barrel index that routes you to
the one or two docs a given change needs.

- [architecture.md](docs/architecture.md) — how the pieces fit and why
- [extension.md](docs/extension.md) — drivers, adding an engine, value handling
- [frontend.md](docs/frontend.md) — React structure and the typed bridge
- [design-system.md](docs/design-system.md) — tokens and rules
- [testing.md](docs/testing.md) — the suites and how to run them
- [decisions.md](docs/decisions.md) — why things are the way they are

## Development

```bash
bun run typecheck    # frontend + extension
bun run test:db:up   # throwaway MySQL + Postgres in Docker
bun test             # extension suite, against real servers
bun run test:ui      # drives the real app (Windows-only)
bun run test:db:down
```

## Limitations

Deliberately minimal: one statement at a time, previews capped at 100 rows, no
result paging, no saved connections (credentials live in memory only), no query
history. Packaging is not set up — see the note in `docs/architecture.md`.
