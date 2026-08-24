import type {
    Environment,
    SavedConnection,
    ServerConfig,
} from '../../../../../shared/protocol/index.ts';
import { engineByType, isFileBased } from '../../../common/db/engines.ts';
import { DEFAULT_CONNECTION_COLOR } from '../../../common/icons/connectionColors.ts';
import type { FormState, RequiredField } from './connectionFormTypes.ts';

// Matches the shipped default environment's own name, which is the only name
// this can know without a policy of what a team calls its production tier. A
// renamed or custom "prod-like" environment simply does not get the default --
// the cost of naming freedom, not a bug.
export const readOnlyDefault = (environment: Environment): boolean => environment === 'production';

export function initialFormState(
    initial: SavedConnection | undefined,
    defaultEnvironment: string,
): FormState {
    if (!initial) {
        return {
            name: '',
            type: 'postgres',
            host: 'localhost',
            port: '',
            user: '',
            password: '',
            database: '',
            environment: defaultEnvironment,
            ssl: false,
            readOnly: readOnlyDefault(defaultEnvironment),
            savePassword: true,
            passwordTouched: false,
            authMethod: 'password',
            awsProfile: '',
            awsRegion: '',
            color: DEFAULT_CONNECTION_COLOR,
        };
    }
    return {
        name: initial.name,
        type: initial.config.type,
        host: initial.config.host,
        port: String(initial.config.port),
        user: initial.config.user,
        database: initial.config.database ?? '',
        environment: initial.environment,
        ssl: initial.config.ssl ?? false,
        readOnly: initial.readOnly,
        password: '',
        savePassword: initial.hasPassword,
        passwordTouched: false,
        authMethod: initial.config.iam ? 'iam' : 'password',
        awsProfile: initial.config.iam?.profile ?? '',
        awsRegion: initial.config.iam?.region ?? '',
        color: initial.color,
    };
}

/**
 * The server the form currently describes.
 *
 * Both what *Connect* submits and what *Test* reaches are this one function, so
 * a draft can never be tested as one thing and saved as another -- which is the
 * only way a test's answer means anything about the row that follows it.
 */
export function serverConfig(form: FormState, iam: boolean): ServerConfig {
    // No server to address and no secret to carry: the empty host, zero port and
    // empty user are what `ServerConfig` documents a file engine writes, and the
    // path travels as `database`.
    if (isFileBased(form.type))
        return { type: form.type, host: '', port: 0, user: '', database: form.database.trim() };

    const engine = engineByType(form.type);
    return {
        type: form.type,
        host: form.host,
        port: Number(form.port) || engine.defaultPort,
        user: form.user || engine.defaultUser,
        database: form.database || undefined,
        ssl: iam ? true : form.ssl,
        ...(iam ? { iam: { profile: form.awsProfile.trim(), region: form.awsRegion.trim() } } : {}),
    };
}

/**
 * What is still empty, in the order the fields are drawn.
 *
 * The order is the whole reason this returns a list rather than a set: a failed
 * submit focuses the first entry, and focusing the last field the user can see
 * because a `Set` happened to iterate that way reads as the form picking at
 * random.
 */
/** The path chosen, or null on a cancel -- which must leave the field alone rather than blanking a path already chosen. */
export async function browseForSqliteFile(): Promise<string | null> {
    const chosen = await Neutralino.os.showOpenDialog('Choose a SQLite database', {
        multiSelections: false,
        filters: [
            { name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    return chosen.length > 0 ? chosen[0]! : null;
}

/** The values a submit sends, from a form already confirmed complete. */
export function submitValues(
    form: FormState,
    iam: boolean,
    fileBased: boolean,
): {
    name: string;
    config: ServerConfig;
    environment: Environment;
    readOnly: boolean;
    password: string;
    savePassword: boolean;
    passwordTouched: boolean;
    color: FormState['color'];
} {
    return {
        name: form.name.trim(),
        config: serverConfig(form, iam),
        environment: form.environment,
        readOnly: form.readOnly,
        password: iam || fileBased ? '' : form.password,
        savePassword: iam || fileBased ? false : form.savePassword,
        passwordTouched: fileBased ? false : form.passwordTouched,
        color: form.color,
    };
}

export function missingFields(form: FormState, iam: boolean, fileBased: boolean): RequiredField[] {
    const missing: RequiredField[] = [];
    if (form.name.trim() === '') missing.push('name');
    if (fileBased) {
        if (form.database.trim() === '') missing.push('database');
        return missing;
    }
    if (form.host.trim() === '') missing.push('host');
    if (iam) {
        if (form.awsProfile.trim() === '') missing.push('awsProfile');
        if (form.awsRegion.trim() === '') missing.push('awsRegion');
    }
    return missing;
}
