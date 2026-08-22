/**
 * Levelled, timestamped logging for the extension, the one process nothing
 * else can see inside once it is running as a spawned, shell-less binary.
 *
 * Written to a bounded file in the app data directory -- the same folder
 * `app.dataDir` already points the About menu's "Open app data" at, so
 * whatever this writes is somewhere a user hitting a dead or unresponsive app
 * can actually find.
 *
 * Never pass a SQL statement or a database value here. Those are the data the
 * store's encryption exists to protect; a log holding them would be a copy of
 * it sitting in plaintext next to the encrypted file.
 */

import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { dataDir } from './store.ts';

const LOG_FILE = 'squeal-ext.log';

/** Rotated to `.old` (one generation) once the active file passes this. */
const MAX_BYTES = 5 * 1024 * 1024;

type Level = 'info' | 'warn' | 'error';

let dirReady = false;

function logPath(): string {
    if (!dirReady) {
        mkdirSync(dataDir(), { recursive: true });
        dirReady = true;
    }
    return join(dataDir(), LOG_FILE);
}

function rotateIfNeeded(path: string): void {
    let size: number;
    try {
        size = statSync(path).size;
    } catch {
        return; // Nothing written yet.
    }
    if (size < MAX_BYTES) return;
    try {
        unlinkSync(`${path}.old`);
    } catch {
        // Nothing to delete -- fine, there was no previous rotation yet.
    }
    try {
        renameSync(path, `${path}.old`);
    } catch {
        // Best effort -- a failed rotation should not stop logging.
    }
}

function write(level: Level, message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    // Stays visible in dev (`bun start` inherits this process's stderr); the
    // file below is what survives once the app is packaged and there is no
    // terminal watching it.
    process.stderr.write(line);
    try {
        const path = logPath();
        rotateIfNeeded(path);
        appendFileSync(path, line);
    } catch {
        // The file destination is best effort; stderr above already carries it.
    }
}

export const log = {
    info: (message: string) => write('info', message),
    warn: (message: string) => write('warn', message),
    error: (message: string) => write('error', message),
};
