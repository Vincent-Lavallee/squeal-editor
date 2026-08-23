import type { AiModel, AiProvider } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

export const loadAiStatus = createAppThunk(
    'assistant/status',
    async (_: void, { rejectWithValue }) => {
        try {
            return await call('ai.status', {});
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Hand a pasted key to the extension, which proves it before keeping it.
 *
 * The key travels once, on this call, and never comes back: what resolves is a
 * status naming the provider. Nothing in the store ever holds the key, so
 * nothing that renders from the store can leak it.
 */
export const connect = createAppThunk(
    'assistant/connect',
    async ({ provider, key }: { provider: AiProvider; key: string }, { rejectWithValue }) => {
        try {
            return await call('ai.connect', { provider, key });
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/** Named for what it does rather than for its command, so it cannot be read as the *connection*'s disconnect. */
export const removeKey = createAppThunk(
    'assistant/removeKey',
    async (_: void, { rejectWithValue }) => {
        try {
            await call('ai.disconnect', {});
            return true;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/** The catalog for the stored key. The extension decides which row is the default; see `preferredModel`. */
export const loadModels = createAppThunk(
    'assistant/models',
    async (_: void, { rejectWithValue }) => {
        try {
            const { models } = await call('ai.models', {});
            return models;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * The default model: the one the extension marked while reading the catalog.
 *
 * Expressed as a *rule over the catalog* rather than as an id, for the reason
 * the catalog is fetched at all -- which model is current moves every few months
 * and a hardcoded default is stale before anyone notices. Which rule that is,
 * per provider, is the extension's to know; this side only reads the mark.
 *
 * It is deliberately **not** chosen by price, even though the user now pays per
 * token. Cost was reported here for a while and is gone entirely; see
 * `docs/decisions.md`.
 */
export function preferredModel(models: AiModel[]): string | null {
    return (models.find((model) => model.isDefault) ?? models[0])?.id ?? null;
}
