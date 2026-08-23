import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConnectionColorId, WorkspaceIconId } from '../../shared/protocol/index.ts';
import { runMigrations } from './migrations/runner.ts';

export function dataDir(): string {
    const override = process.env.SQUEAL_DATA_DIR;
    if (override) return override;

    if (process.platform === 'win32') {
        return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'squeal-editor');
    }
    if (process.platform === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'squeal-editor');
    }
    return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'squeal-editor');
}

/*
 * The tables are not declared here. `migrations.ts` owns the schema outright --
 * it is what running that list from nothing produces -- because a `CREATE TABLE`
 * kept beside the migrations is a second answer to "what shape is this file?"
 * that drifts from the first the moment either is edited alone.
 *
 * Two shapes the rest of this file leans on, both made there: a connection's
 * name is not unique at all -- it is a label, and `id` is the key -- and its
 * `workspace_id` references `workspaces` ON DELETE CASCADE.
 */

/** What a store with no workspaces yet gets, so the feature can be ignored. */
export const DEFAULT_WORKSPACE_NAME = 'Default';
export const DEFAULT_WORKSPACE_ICON: WorkspaceIconId = 'stack';
/** What a store with no environments yet gets -- the same four the app always shipped. */
export const DEFAULT_ENVIRONMENTS = ['local', 'dev', 'qa', 'production'];
/** The neutral swatch: what a connection wears until the user picks otherwise, and
 *  what a row written before the colour column existed migrates to. */
export const DEFAULT_CONNECTION_COLOR: ConnectionColorId = 'slate';

export interface Row {
    id: string;
    workspace_id: string;
    name: string;
    engine: string;
    host: string;
    port: number;
    username: string;
    default_database: string | null;
    environment: string;
    /** SQLite has no boolean; 0 or 1. `toSaved` is the only place that reads it. */
    ssl: number;
    /** SQLite has no boolean; 0 or 1. Open the connection refusing writes. */
    read_only: number;
    /**
     * Both null for a password connection; both set for an IAM one. Their presence
     * is the auth method -- there is no separate flag, because a third column
     * saying what these two already say is two sources for one fact. An IAM row
     * stores no password, so `password` stays null and `hasPassword` is false.
     */
    aws_profile: string | null;
    aws_region: string | null;
    password: Uint8Array | null;
    color: string;
}

export interface WorkspaceRow {
    id: string;
    name: string;
    icon: string;
}

export interface EnvironmentRow {
    id: string;
    name: string;
    position: number;
}

let db: Database | null = null;

export function open(): Database {
    if (db) return db;
    mkdirSync(dataDir(), { recursive: true });
    db = new Database(join(dataDir(), 'squeal.db'));

    // Off by default in SQLite, and per-connection rather than stored in the file,
    // so it has to be set on every open or the REFERENCES clause is decoration.
    // Before the migrations, so a rebuild among them runs under the same rules the
    // app does.
    db.run('PRAGMA foreign_keys = ON');
    runMigrations(db);

    // A data invariant rather than a schema one, so it lives here and not in a
    // migration: the migration that introduced workspaces made the first one, but
    // "there is always at least one" has to hold on every launch, not once.
    ensureDefaultWorkspace(db);
    ensureDefaultEnvironments(db);
    return db;
}

/**
 * There is always at least one workspace. Connections hang off one, so a store
 * with none has nowhere to put a connection -- which is also why deleting the
 * last one is refused rather than handled by recreating this on next launch.
 */
function ensureDefaultWorkspace(database: Database): void {
    const existing = database.query('SELECT id FROM workspaces LIMIT 1').get() as {
        id: string;
    } | null;
    if (existing) return;

    database.run('INSERT INTO workspaces (id, name, icon) VALUES (?, ?, ?)', [
        randomUUID(),
        DEFAULT_WORKSPACE_NAME,
        DEFAULT_WORKSPACE_ICON,
    ]);
}

/**
 * There is always at least one environment, the same invariant and the same
 * reason as the default workspace above: the connect form needs one to offer
 * a brand-new connection. The migration already seeds these four on a fresh
 * store; this is the safety net for a store some other path left empty.
 */
function ensureDefaultEnvironments(database: Database): void {
    const existing = database.query('SELECT id FROM environments LIMIT 1').get() as {
        id: string;
    } | null;
    if (existing) return;

    DEFAULT_ENVIRONMENTS.forEach((name, position) => {
        database.run('INSERT INTO environments (id, name, position) VALUES (?, ?, ?)', [
            randomUUID(),
            name,
            position,
        ]);
    });
}

/** Tests only: the store is a process-lifetime singleton in the app itself. */
export function closeCoreStore(): void {
    db?.close();
    db = null;
}
