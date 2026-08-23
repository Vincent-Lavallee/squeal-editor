import { AI_DELTA_EVENT } from '../../shared/protocol/index.ts';
import {
    cancel as cancelTurn,
    connect as connectAssistant,
    disconnect as disconnectAssistant,
    models as assistantModels,
    send as sendTurn,
    status as assistantStatus,
} from './assistant.ts';
import type { Handlers, Send } from './commandTypes.ts';

/* eslint-disable @typescript-eslint/require-await -- Handlers requires every
   command to return a Promise so the dispatcher can await them uniformly; not
   every handler happens to need one. */
export function commandsAssistant(
    send: Send,
): Pick<
    Handlers,
    'ai.status' | 'ai.connect' | 'ai.disconnect' | 'ai.models' | 'ai.send' | 'ai.cancel'
> {
    return {
        async 'ai.status'() {
            return assistantStatus();
        },

        async 'ai.connect'({ provider, key }) {
            return connectAssistant(provider, key);
        },

        async 'ai.disconnect'() {
            await disconnectAssistant();
            return { ok: true };
        },

        async 'ai.models'() {
            return { models: await assistantModels() };
        },

        async 'ai.send'({ turnId, model, messages, tools }) {
            return {
                message: await sendTurn(turnId, {
                    model,
                    messages,
                    tools,
                    onDelta: (text) => send(AI_DELTA_EVENT, { turnId, text }),
                }),
            };
        },

        async 'ai.cancel'({ turnId }) {
            cancelTurn(turnId);
            return { ok: true };
        },
    };
}
/* eslint-enable @typescript-eslint/require-await */
