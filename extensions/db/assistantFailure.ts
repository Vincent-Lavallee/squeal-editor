import { providerLabel, type AiProvider } from '../../shared/protocol/index.ts';
import { ANTHROPIC_VERSION, ENDPOINTS } from './assistantEndpoints.ts';

/**
 * Whatever the provider actually said, preferred over anything invented here.
 *
 * All four wrap their message the same way (`{ error: { message } }`), and the
 * message is the only thing that tells "this key is not funded" apart from "this
 * key is not a key" -- which are two different things for the user to go and do.
 */
function stated(detail: string): string | undefined {
    try {
        const body = JSON.parse(detail) as {
            error?: { message?: string } | string;
            message?: string;
        };
        if (typeof body.error === 'string') return body.error;
        return body.error?.message ?? body.message;
    } catch {
        return undefined;
    }
}

function providerFailure(provider: AiProvider, statusCode: number, detail: string): Error {
    const label = providerLabel(provider);
    const said = stated(detail);

    if (statusCode === 401 || statusCode === 403)
        return new Error(said ?? `${label} rejected this API key.`);
    if (statusCode === 402) return new Error(said ?? `${label} says this account has no credit.`);
    if (statusCode === 429)
        return new Error(said ?? `${label} is rate limiting this key. Try again shortly.`);
    return new Error(said ?? `${label} refused the request (${statusCode}).`);
}

export async function refuse(provider: AiProvider, response: Response): Promise<never> {
    throw providerFailure(provider, response.status, await response.text().catch(() => ''));
}

export function authHeaders(provider: AiProvider, key: string): Record<string, string> {
    return ENDPOINTS[provider].wire === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
        : { Authorization: `Bearer ${key}` };
}
