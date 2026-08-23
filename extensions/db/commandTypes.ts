import type { CommandName, CommandReq, CommandRes } from '../../shared/protocol/index.ts';

export type Handlers = { [K in CommandName]: (req: CommandReq<K>) => Promise<CommandRes<K>> };

/** What every command handler group needs to broadcast an event back to the UI. */
export type Send = (event: string, data: unknown) => void;
