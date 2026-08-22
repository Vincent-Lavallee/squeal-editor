import { isFileEngine, type EngineType } from '../../../../shared/protocol/index.ts';

/**
 * The only engine-specific knowledge the UI is allowed to hold: a label, and
 * what to fall back to when the connect form is left blank. Nothing here knows
 * a dialect, a quoting rule or a catalog -- that lives in the drivers.
 *
 * It is shared rather than owned by the connect form because the toolbar needs
 * the label too, and a second copy of this table is how the two drift apart.
 */
export interface Engine {
    value: EngineType;
    label: string;
    defaultPort: number;
    defaultUser: string;
}

export const ENGINES: Engine[] = [
    { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432, defaultUser: 'postgres' },
    { value: 'mysql', label: 'MySQL', defaultPort: 3306, defaultUser: 'root' },
    // No port and no user: the address is a file path, which the form collects
    // into `config.database` -- see `ServerConfig`.
    { value: 'sqlite', label: 'SQLite', defaultPort: 0, defaultUser: '' },
];

export const engineByType = (type: EngineType): Engine =>
    ENGINES.find((e) => e.value === type) ?? ENGINES[0]!;

export const engineLabel = (type: EngineType): string => engineByType(type).label;

/**
 * Whether this engine's connection is a file rather than a server.
 *
 * A file has no host, port, user, password or TLS, so everything that would
 * collect or demand one asks here -- the connect form for which fields to draw,
 * the connect screen for whether a missing stored password means "prompt", and
 * `serverLabel` for whether there is an address to print.
 *
 * Re-exported from the protocol rather than answered here, and that is the whole
 * point: the extension's store asks the *same* question before it will resolve a
 * saved connection, and when this table answered it alone the two disagreed --
 * the form saved a SQLite connection happily and connecting to it came back
 * "does not store a password; one is needed to connect".
 */
export { isFileEngine as isFileBased };
