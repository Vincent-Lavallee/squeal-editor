# Docs index (barrel)

Load only what the task needs. Each doc is self-contained; none of them require
reading the others first, except `architecture.md`, which is the map.

## Routing table

| If you are… | Read |
|---|---|
| new to the repo, or touching more than one layer | `architecture.md` |
| adding/changing a database engine, or touching SQL, drivers, value handling | `extension.md` |
| changing the bridge, protocol, or a command's payload | `extension.md` + `frontend.md` |
| touching saved connections, workspaces, the store, passwords or the keychain | `extension.md` + `decisions.md` |
| changing the store's schema, or anything a store on disk already holds | `extension.md` + `testing.md` |
| adding or reading a user preference that has to be remembered | `extension.md` + `frontend.md` |
| adding a keyboard shortcut, or changing what a key does | `frontend.md` + `decisions.md` |
| touching the connect screen, workspaces or environments in the UI | `frontend.md` + `decisions.md` |
| touching the rail, or anything that must hold for every open connection | `frontend.md` + `decisions.md` |
| adding a new way to connect (IAM, SSH, …) | `frontend.md` + `decisions.md` |
| touching what happens when a connection drops, or a driver's client lifecycle | `extension.md` + `decisions.md` |
| touching React components, state, or the UI's data flow | `frontend.md` |
| touching the editor, its completion, or what it knows about the schema | `frontend.md` + `extension.md` |
| touching the relationship diagram, its layout, or what it reads | `frontend.md` + `extension.md` |
| touching the assistant: its tools, what it may see, or what it must ask before doing | `frontend.md` + `decisions.md` |
| touching what a conversation remembers, or what of it reaches the disk | `frontend.md` + `extension.md` + `decisions.md` |
| touching how a model is reached — the API key, a provider, the models | `extension.md` + `decisions.md` |
| adding an AI provider, or changing a wire format or a model filter | `extension.md` + `decisions.md` |
| touching what one *Run* sends, or how a tab is cut into statements | `frontend.md` + `decisions.md` |
| touching saved queries, or anything a tab remembers about where its text came from | `frontend.md` + `extension.md` |
| touching the titlebar, window controls, dragging, resizing or the frame's colour | `frontend.md` + `decisions.md` |
| touching the window's native frame — the injected chrome DLL, the resize strips | `frontend.md` + `extension.md` + `decisions.md` |
| writing any markup or CSS, adding a component, picking a colour or an icon | `design-system.md` |
| redrawing the app icon | `design-system.md` + `architecture.md` |
| adding tests, or verifying a change | `testing.md` |
| wondering *why* something is the way it is, before changing it | `decisions.md` |
| packaging, distribution, or the Neutralino config | `architecture.md` + `decisions.md` |
| the auto-updater, release signing, or update assets | `extension.md` + `decisions.md` |
| touching CI, its workflows, or how a PR gets checked | `testing.md` + `decisions.md` |

## The docs

- **[architecture.md](architecture.md)** — how the three pieces fit, why the
  extension exists at all, the bridge protocol, and the repo layout.
- **[extension.md](extension.md)** — the Bun/TypeScript process that owns the
  connections: drivers, the connection registry, adding an engine, the store and
  its migration, and the value handling rules that keep data truthful.
- **[frontend.md](frontend.md)** — the React app: structure, state, the typed
  bridge, and how it stays engine-agnostic.
- **[design-system.md](design-system.md)** — tokens, primitives, the rules that
  keep it coherent, and what was adopted/adapted/dropped from the reference.
- **[testing.md](testing.md)** — the test databases, the two suites, and why
  they run against real servers.
- **[decisions.md](decisions.md)** — the record of *why*: Neutralino, Bun, the
  extension model, value handling, the heartbeat. Read before reversing anything.

## Conventions

- `shared/protocol/` is the contract between the UI and the extension. Change
  it and both sides must agree — that is the point of it existing. It is six
  domain files behind one barrel: **import `protocol/index.ts`, never a domain
  file directly**, so a type can move between them without touching its callers.
- `extensions/db/drivers/` is the same rule applied to the engines: the contract,
  the shared assemblers and one file per engine, behind `drivers/index.ts`.
  Import the barrel; only the engine files reach past it, and only inward.
- Comments explain *why*, never *what*. If a line looks arbitrary, it needs a
  comment; if it reads plainly, it does not.
- Prose in these docs describes the current state. `decisions.md` is the only
  place that may discuss what was rejected.
- Work that is *not* done yet is not documentation. It lives in `backlog.md` and
  `completed.md` at the repo root, written via the `backlog` skill — never here.
