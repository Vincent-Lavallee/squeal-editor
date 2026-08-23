import { providerLabel, type AiModel, type AiProvider } from '../../shared/protocol/index.ts';
import { authHeaders, refuse } from './assistantFailure.ts';
import { ENDPOINTS } from './assistantEndpoints.ts';
import { credentialOrThrow } from './assistantCredential.ts';

interface CatalogEntry {
    id?: string;
    display_name?: string;
    created?: number;
    created_at?: string;
}

export async function models(): Promise<AiModel[]> {
    const { provider, key } = await credentialOrThrow();
    return fetchModels(provider, key);
}

/**
 * What this key may use, newest first, with one row marked as the default.
 *
 * The whole list is sorted by publication date before anything is chosen from
 * it, which is what makes the preference patterns age: `prefers` says *what kind
 * of model* to start on and the sort decides *which* one, so a provider shipping
 * a newer Sonnet needs no change here.
 *
 * **A filter that matches nothing falls back to the unfiltered catalog.** These
 * patterns encode what four providers name their models today, and the failure
 * mode of a stale pattern is an empty picker with no way for the user to
 * diagnose it -- offering everything is a worse catalog and a recoverable one.
 */
export async function fetchModels(provider: AiProvider, key: string): Promise<AiModel[]> {
    const endpoint = ENDPOINTS[provider];
    const response = await fetch(`${endpoint.base}/models`, {
        headers: { Accept: 'application/json', ...authHeaders(provider, key) },
    });
    if (!response.ok) await refuse(provider, response);

    const body = (await response.json()) as { data?: CatalogEntry[]; models?: CatalogEntry[] };
    const entries = body.data ?? body.models ?? [];

    const all = entries
        .filter((entry): entry is CatalogEntry & { id: string } => typeof entry.id === 'string')
        .map((entry) => ({
            // Gemini lists its ids as `models/gemini-…` and takes them either way; the
            // bare form is what the picker shows and what the request carries.
            id: entry.id.replace(/^models\//, ''),
            name: entry.display_name ?? entry.id.replace(/^models\//, ''),
            publishedAt: entry.created_at
                ? Date.parse(entry.created_at)
                : (entry.created ?? 0) * 1000,
        }))
        .sort((left, right) => right.publishedAt - left.publishedAt);

    const usable = all.filter(
        (model) => endpoint.keeps.test(model.id) && !endpoint.rejects?.test(model.id),
    );
    const offered = usable.length ? usable : all;
    if (!offered.length)
        throw new Error(`${providerLabel(provider)} listed no models for this key.`);

    const preferred =
        endpoint.prefers
            .map((pattern) => offered.find((model) => pattern.test(model.id)))
            .find(Boolean) ?? offered[0];

    return offered.map((model) => ({
        id: model.id,
        name: model.name,
        vendor: providerLabel(provider),
        ...(model.id === preferred?.id ? { isDefault: true } : {}),
    }));
}
