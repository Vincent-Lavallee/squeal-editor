import mysql from 'mysql2/promise';
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';

import { KEEPALIVE_DELAY_MS, tlsOptions } from '../common.ts';
import type { Driver } from '../driver.ts';

export const mysqlLifecycle: Pick<
    Driver<MysqlConnection>,
    | 'createClient'
    | 'onClientLost'
    | 'isConnectionLost'
    | 'closeClient'
    | 'destroyClient'
    | 'serverVersion'
> &
    ThisType<Driver<MysqlConnection>> = {
    async createClient(config, database) {
        return mysql.createConnection({
            host: config.host,
            port: Number(config.port) || this.defaultPort,
            user: config.user,
            password: config.password,
            database: database || config.database || undefined,
            // Undefined rather than false: mysql2 reads any `ssl` value as a request
            // for TLS, so `ssl: false` is not "off", it is "on, with no options".
            ssl: config.ssl ? tlsOptions(config) : undefined,
            // Keep the door shut on stacked statements; the editor runs one at a time.
            multipleStatements: false,
            // Same reasoning as the Postgres type parsers: MySQL's DATETIME carries no
            // offset, so let it stay the literal string the server sent.
            dateStrings: true,
            // Without this, BIGINT arrives as a JS number and anything past 2^53 is
            // silently rounded (9007199254740993 -> ...992). Values that fit stay
            // numbers; only those that would lose precision become strings.
            supportBigNumbers: true,
            bigNumberStrings: false,
            // TCP keepalive, so an idle connection keeps proving it is there. The
            // thing between this app and an RDS instance -- a load balancer, RDS
            // Proxy -- reaps a silent connection on its own timer, and a probe every
            // 30s is what stops a connection that is merely being read from looking
            // abandoned. It reduces drops; it does not make them impossible, which is
            // why `onClientLost` exists regardless.
            enableKeepAlive: true,
            keepAliveInitialDelay: KEEPALIVE_DELAY_MS,
        });
    },

    onClientLost(client, handler) {
        let fired = false;
        const once = (reason: string) => {
            if (fired) return;
            fired = true;
            handler(reason);
        };
        // Both, because they are different endings and either leaves the client
        // unusable: `error` is the socket failing under us, `end` is the server
        // saying goodbye first. mysql2 reaches `error` for a fatal network error
        // only when no command is in flight to hand it to -- exactly the idle case
        // that would otherwise crash the process.
        client.on('error', (err: Error) => once(err.message));
        client.on('end', () => once('The server closed the connection.'));
    },

    // mysql2 marks every error that ends the connection `fatal`, and marks nothing
    // else that way -- a syntax error or a constraint violation arrives without it.
    // That flag is the library answering this exact question, so it is read rather
    // than re-derived from the error code list it is already computed from.
    isConnectionLost(err) {
        return err instanceof Error && (err as Error & { fatal?: boolean }).fatal === true;
    },

    async closeClient(client) {
        await client.end();
    },

    destroyClient(client) {
        client.destroy();
    },

    async serverVersion(client) {
        const [rows] = (await client.query({ sql: 'SELECT VERSION()', rowsAsArray: true })) as [
            string[][],
            FieldPacket[],
        ];
        return rows[0]?.[0] ?? '';
    },
};
