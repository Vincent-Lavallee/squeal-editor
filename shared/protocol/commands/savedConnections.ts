/**
 * Saved connections: the store's list of servers, exported/imported as a
 * file, plus a session's session snapshot and its starred tables. The store
 * is the extension's; the UI only ever sees `SavedConnection`, which is to
 * say never a password.
 */

import type {
    ConnectionColorId,
    ConnectionExportSummary,
    ConnectionImportSummary,
    Environment,
    PasswordUpdate,
    SavedConnection,
    ServerConfig,
    SqlDialect,
} from '../config.ts';
import type { StarredTable } from '../results.ts';

export interface SavedConnectionCommands {
    'db.saved.list': {
        req: Record<string, never>;
        res: { connections: SavedConnection[] };
    };
    /** Omit `id` to add; pass one to update it in place. */
    'db.saved.save': {
        req: {
            id?: string;
            workspaceId: string;
            name: string;
            config: ServerConfig;
            environment: Environment;
            readOnly: boolean;
            password: PasswordUpdate;
            color: ConnectionColorId;
        };
        res: { connection: SavedConnection };
    };
    'db.saved.delete': {
        req: { id: string };
        res: { ok: true };
    };
    /**
     * `password` is required only for a saved connection that stores none; the
     * extension decrypts its own otherwise. Echoes the config back rather than
     * letting the UI seed its session from a list row that may be stale.
     *
     * `name`, `environment`, `workspaceId` and `color` come back for that same
     * reason, and they are what a session is labelled, grouped and tinted by once
     * more than one can be open. None is anything the extension does with a
     * connection -- it carries them the way it carries `dialect`, because the row
     * they live in is its to read. `workspaceId` is what lets the rail group the
     * connection under its workspace; `color` is what lets its chip wear its own
     * swatch, since the workspace it is grouped under carries none of its own.
     *
     * `readOnly` is the exception that *is* acted on: it is the stored row's, so it
     * comes back rather than being recomputed up top, and the extension has already
     * applied it to the connection it hands back.
     */
    'db.saved.connect': {
        req: { id: string; password?: string };
        res: {
            connectionId: string;
            databases: string[];
            dialect: SqlDialect;
            /**
             * The schema that goes without saying on this engine, carried the way
             * `dialect` is: the tree leaves it off a relation's printed name, and the
             * UI never has to hold a table of which engine calls its default what.
             * Absent for an engine with no schema layer.
             */
            defaultSchema?: string;
            config: ServerConfig;
            name: string;
            environment: Environment;
            workspaceId: string;
            color: ConnectionColorId;
            readOnly: boolean;
            /**
             * The tabs and queries this connection had open when it was last saved, so
             * connecting reopens them. `null` when the connection has none stored --
             * a brand-new one, or one that has never been left with anything open.
             *
             * An **opaque string**, the settings rule applied to a whole session: the
             * store keeps text and the UI owns its meaning. Only the UI reads it and
             * the extension never parses it, so putting a tab shape into this shared
             * contract would be a vocabulary neither the store nor this file needs.
             * The UI JSON-encodes its own `SessionSnapshot` on the way out (see
             * `db.session.save`) and decodes it here. Bundled onto connect rather than
             * fetched separately so restore lands with the connection in one shot,
             * with no window where the default tab is minted before it arrives.
             */
            session: string | null;
        };
    };

    /**
     * Write every workspace and every connection to a file, for carrying to
     * another machine or keeping as a backup.
     *
     * **The extension writes the file; the UI only names it.** That is the one
     * design decision in this pair and it is the password's doing: with
     * `includePasswords` the document holds secrets in plain text, and handing it
     * back over the bridge to be written up there would break the rule the whole
     * store is built on -- a password travels toward the UI never, not merely
     * rarely. So `path` comes down (the webview owns the native save dialog, the
     * same way it owns the file picker that chooses a SQLite database) and only a
     * tally goes back.
     *
     * `includePasswords` is off unless the user ticked a box that says outright
     * what it does. Passwords are sealed with a key from the OS keychain, which
     * does not travel with the file, so including them means decrypting them out
     * of the store and onto disk in the clear -- a deliberate choice, never a
     * default, and never a silent one.
     */
    'db.saved.export': {
        req: { path: string; includePasswords: boolean };
        res: ConnectionExportSummary;
    };
    /**
     * Read such a file back and **merge** it into the store: a workspace or a
     * connection the store already has is written over in place, and everything
     * else is added. Nothing is deleted, so importing can only ever be additive --
     * a connection this store has and the file does not is left alone.
     *
     * The whole file lands or none of it does. `path` rather than the document for
     * `db.saved.export`'s reason with the direction reversed: the file may carry
     * plain-text passwords, so the side that owns the encrypted store is the side
     * that reads them, and the webview never holds one.
     *
     * A password the file does not carry leaves the stored one alone, and a
     * connection that ends up with none simply asks when it is connected to --
     * which is the prompt an unsaved password already gets, not a new one.
     */
    'db.saved.import': {
        req: { path: string };
        res: ConnectionImportSummary;
    };

    /**
     * Persist a connection's open tabs and queries, so `db.saved.connect` can hand
     * them back next time. `session` is the UI's JSON'd snapshot, stored verbatim.
     *
     * Keyed by the *saved* connection's id, never the runtime one -- a session has
     * to outlive the connection that wrote it, the same reason stars are. The store
     * keeps one snapshot per saved connection, replaced outright on each save.
     */
    'db.session.save': {
        req: { savedConnectionId: string; session: string };
        res: { ok: true };
    };

    /**
     * Every table a saved connection has starred, across every database it has
     * ever browsed. Fetched once per session, the same way `db.saved.connect`
     * hands back `databases` -- there is no per-database call because the whole
     * point is a tree switching database costs nothing extra to ask about.
     *
     * `savedConnectionId` names the *saved* row, never the runtime `connectionId`
     * a live connection carries: a star has to outlive the session it was set in,
     * and the runtime id is minted fresh every time `db.connect` runs. The two
     * ids happen to be the same string only for `db.saved.connect`'s caller, who
     * already holds both.
     */
    'db.stars.list': {
        req: { savedConnectionId: string };
        res: { stars: StarredTable[] };
    };
    /**
     * Star or unstar one relation, from the tree's context menu. Idempotent: the
     * UI sends the state it wants, not a toggle, so a menu opened twice cannot
     * flip a star back by accident.
     */
    'db.stars.set': {
        req: {
            savedConnectionId: string;
            database: string;
            table: string;
            schema?: string;
            starred: boolean;
        };
        res: { ok: true };
    };
}
