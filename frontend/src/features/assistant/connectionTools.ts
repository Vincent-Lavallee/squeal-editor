/** The labels, so the model can choose between them. */

import type { Tool } from './toolHelpers.ts';

/* eslint-disable @typescript-eslint/require-await -- Tool.run returns
   Promise<unknown> so the assistant loop can await every tool uniformly; not
   every tool happens to need one. */
export const CONNECTION_TOOLS: Tool[] = [
    {
        def: {
            name: 'getConnections',
            description:
                'The connections currently open, with the database each is on. Call this before targeting a connection other than the one in front. ' +
                'The environment says which is production; treat those with care.',
            parameters: { type: 'object', properties: {} },
        },
        target: () => 'open connections',
        async run(_args, ctx) {
            const state = ctx.getState();
            // Deliberately no host, port, user or SSL: the model needs to tell two
            // connections apart, which is a label, not an address.
            return {
                connections: state.session.order.flatMap((id) => {
                    const connection = state.session.connections[id];
                    if (!connection) return [];
                    const tab = state.tabs.tabs.find((t) => t.connectionId === id && t.database);
                    return [
                        {
                            connectionId: id,
                            name: connection.name,
                            environment: connection.environment,
                            engine: connection.config.type,
                            dialect: connection.dialect,
                            database: tab?.database ?? null,
                            readOnly: connection.readOnly,
                            active: id === state.session.activeConnectionId,
                        },
                    ];
                }),
            };
        },
    },
];
/* eslint-enable @typescript-eslint/require-await */
