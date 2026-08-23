import type { AiProvider, AiStatus } from '../../shared/protocol/index.ts';
import { log } from './log.ts';
import { ENDPOINTS } from './assistantEndpoints.ts';
import { fetchModels } from './assistantCatalog.ts';

const KEYCHAIN_SERVICE = process.env.SQUEAL_KEYCHAIN_SERVICE ?? 'squeal-editor';
const CREDENTIAL_NAME = 'ai-credential';

export interface Credential {
    provider: AiProvider;
    key: string;
}

/**
 * One credential, not one per provider.
 *
 * Which provider is in use and the key it needs are one fact, so they are one
 * secret: a provider id kept anywhere else could disagree with the key beside
 * it, and the failure that produces is a working key sent to the wrong company.
 */
async function storedCredential(): Promise<Credential | null> {
    const raw = await Bun.secrets.get({ service: KEYCHAIN_SERVICE, name: CREDENTIAL_NAME });
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Credential;
        return parsed.provider in ENDPOINTS && parsed.key ? parsed : null;
    } catch {
        return null;
    }
}

export async function disconnect(): Promise<void> {
    try {
        await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name: CREDENTIAL_NAME });
    } catch {
        // Nothing stored is the state disconnecting is trying to reach.
    }
}

/**
 * Keep a key, once the provider has agreed it is one.
 *
 * The catalog request is the proof and it is deliberately not optional: this is
 * the only moment the user is watching a key they just pasted, so it is the only
 * moment "that key is wrong" can be said to the person who can fix it. A key
 * that fails here is not written, so the panel does not come back claiming to be
 * connected to something that will refuse every turn.
 */
export async function connect(provider: AiProvider, key: string): Promise<AiStatus> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('Paste an API key first.');

    await fetchModels(provider, trimmed);
    await Bun.secrets.set({
        service: KEYCHAIN_SERVICE,
        name: CREDENTIAL_NAME,
        value: JSON.stringify({ provider, key: trimmed }),
    });
    log.info(`assistant: connected to ${provider}`);
    return { state: 'ready', provider };
}

/**
 * Answer where the user stands, and never throw doing it.
 *
 * `AwsCredentialStatus`'s rule. It reads the keychain and stops there: a key is
 * not a session that expires while nobody is looking, so proving one at launch
 * would spend a request on every start to learn what the first turn learns
 * anyway. `unavailable` is left meaning what it says -- the keychain itself
 * would not answer.
 */
export async function status(): Promise<AiStatus> {
    try {
        const credential = await storedCredential();
        return credential ? { state: 'ready', provider: credential.provider } : { state: 'no-key' };
    } catch (err) {
        return { state: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
    }
}

export async function credentialOrThrow(): Promise<Credential> {
    const credential = await storedCredential();
    if (!credential) throw new Error('No API key is stored. Add one to use the assistant.');
    return credential;
}
