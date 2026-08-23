/**
 * Every command the UI may issue, with its request and response shape.
 *
 * This is the half of the contract that is a *verb*: the domains beside it name
 * the nouns that travel, and `Commands` says which of them may be asked for and
 * what comes back.
 *
 * Split by sub-domain under `commands/` the way this directory is split by
 * domain: `db` (connecting, browsing, running SQL, DDL), `savedConnections`
 * (the store's list of servers, its export/import, a session's snapshot and
 * stars), `store` (workspaces, environments, saved queries, conversations,
 * settings -- everything else the store keeps that is not about one
 * connection) and `system` (AWS, the native window, the app's data
 * directory, the updater, the assistant provider). `Commands` merges the
 * four; nothing outside this file imports from `commands/` directly.
 */

import type { DbCommands } from './commands/db.ts';
import type { SavedConnectionCommands } from './commands/savedConnections.ts';
import type { StoreCommands } from './commands/store.ts';
import type { SystemCommands } from './commands/system.ts';

export type { ResizeEdge } from './commands/system.ts';

/**
 * Every command the UI may issue, with its request and response shape.
 * `bridge.call` is typed from this map, so a typo or a wrong payload is a
 * compile error rather than a silent timeout.
 */
export interface Commands
    extends DbCommands, SavedConnectionCommands, StoreCommands, SystemCommands {}

export type CommandName = keyof Commands;
export type CommandReq<K extends CommandName> = Commands[K]['req'];
export type CommandRes<K extends CommandName> = Commands[K]['res'];
