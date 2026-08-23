import type {
    ConnectionColorId,
    EngineType,
    Environment,
    ServerConfig,
} from '../../../../shared/protocol/index.ts';

export interface FormValues {
    name: string;
    config: ServerConfig;
    environment: Environment;
    readOnly: boolean;
    password: string;
    savePassword: boolean;
    passwordTouched: boolean;
    color: ConnectionColorId;
}

export type AuthMethod = 'password' | 'iam';

export interface FormState {
    name: string;
    type: EngineType;
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    environment: Environment;
    ssl: boolean;
    readOnly: boolean;
    savePassword: boolean;
    passwordTouched: boolean;
    authMethod: AuthMethod;
    awsProfile: string;
    awsRegion: string;
    color: ConnectionColorId;
}

/**
 * The fields that must hold something before this form describes a connection.
 * Which of them apply depends on the engine and the authentication method, so
 * the set is computed rather than declared -- see `missingFields`.
 */
export type RequiredField = 'name' | 'host' | 'database' | 'awsProfile' | 'awsRegion';
