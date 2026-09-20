// Schemas we hide from the tree -- the built-in ones every database carries
// that hold no user relations, the same role PG_SYSTEM_SCHEMAS plays.
export const MSSQL_SYSTEM_SCHEMAS = [
    'sys',
    'INFORMATION_SCHEMA',
    'db_accessadmin',
    'db_backupoperator',
    'db_datareader',
    'db_datawriter',
    'db_ddladmin',
    'db_denydatareader',
    'db_denydatawriter',
    'db_owner',
    'db_securityadmin',
    'guest',
];
