import { open } from './storeCore.ts';

/**
 * Every stored setting, as one map.
 *
 * The store keeps text and no opinion about what any key means -- a value's
 * shape belongs to the feature that writes and reads it, which is what keeps a
 * new preference from being a change here. An unwritten key is simply absent,
 * so a caller's own default is the only default there is.
 */
export function listSettings(): Record<string, string> {
    const rows = open().query('SELECT key, value FROM settings').all() as {
        key: string;
        value: string;
    }[];
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Write one setting, inserting it or replacing what is there. */
export function setSetting(key: string, value: string): void {
    open().run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        [key, value],
    );
}
