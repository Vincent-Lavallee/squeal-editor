/**
 * The assistant: which provider answers, and one turn of a conversation.
 *
 * The message shapes here are OpenAI's, because three of the four providers
 * speak that wire format and the fourth is translated in the extension. Nothing
 * in the app reads them as OpenAI's -- they cross the bridge as the assistant's
 * own vocabulary, the same way `SqlDialect` crosses as a value the UI carries
 * and never interprets.
 */

export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek';

/**
 * One provider as the user meets it.
 *
 * Shared rather than owned by either side, because both need it and neither
 * needs the other's half: the UI draws the picker and the *"where do I get one"*
 * link from this, and the extension reads the label to name a failure and to
 * fill `AiModel.vendor`. What is deliberately **not** here is the endpoint, the
 * wire format or the model filter — the UI never makes the request, so it has no
 * business knowing the address.
 *
 * `label` is the product the user recognises rather than the company that bills
 * them, because that is what they are picking: someone holding a key is holding
 * it because they went looking for *Claude*, not for Anthropic PBC.
 */
export interface AiProviderInfo {
  id: AiProvider;
  label: string;
  /** Where a key is minted. The connect screen opens it in a browser. */
  keysUrl: string;
  /** What a key from this provider looks like, shown as the field's placeholder. */
  keyHint: string;
}

/** `as const` so this reads as a non-empty list: the connect screen starts on the first entry. */
export const AI_PROVIDERS = [
  { id: 'anthropic', label: 'Claude', keysUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'ChatGPT', keysUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  { id: 'gemini', label: 'Gemini', keysUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…' },
  { id: 'deepseek', label: 'DeepSeek', keysUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-…' },
] as const satisfies readonly AiProviderInfo[];

export const providerLabel = (id: AiProvider): string => AI_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;

/**
 * Where the user stands with the assistant, **answered rather than thrown**.
 *
 * The same shape and the same reason as `AwsCredentialStatus`: having stored no
 * key is an answer, not a failure of the asking, and a rejection would be
 * indistinguishable at the call site from the keychain being unreadable.
 *
 * It is answered from the keychain alone and costs no request. A key is not a
 * session that can go stale in the background — it is accepted at the moment it
 * is used or it is not — so the only place one is proved is `ai.connect`, where
 * the user has just pasted it and is watching. `unavailable` is what is left:
 * the keychain would not answer, which is a real state and a different screen.
 */
export interface AiStatus {
  state: 'no-key' | 'ready' | 'unavailable';
  provider?: AiProvider;
  reason?: string;
}

/**
 * One model from a provider's catalog.
 *
 * Reported rather than written down, because ids move every few months and a
 * list in the source is a dead default by the time anyone notices. The catalog
 * is filtered in the extension to the models that can hold a tool-using
 * conversation at all; see `docs/extension.md` for what that filter can and
 * cannot promise now that no provider reports tool support.
 */
export interface AiModel {
  id: string;
  name: string;
  /** The provider's label, so the picker can say who a model belongs to without a second lookup. */
  vendor: string;
  /**
   * Whether this is the model the UI should start on.
   *
   * Decided in the extension, one per catalog, because "which model is the good
   * one" is provider knowledge and this is the side that has it. Nothing about
   * *cost* is carried -- see `docs/decisions.md`.
   */
  isDefault?: boolean;
}

/**
 * How much the assistant asks before it acts.
 *
 * `manual` stops for every tool that runs SQL or rewrites a tab. `auto` runs
 * them without asking -- **except on a `production` connection**, which still
 * stops, since that is where this app already spends friction rather than
 * saving it. `bypass` is the same with that exception removed, so nothing at
 * all interrupts. Every mode leaves the same row in the thread: what changes is
 * whether it waited, never whether it was recorded.
 */
export type AiApprovalMode = 'manual' | 'auto' | 'bypass';

export interface AiToolCall {
  id: string;
  name: string;
  /** The model's own JSON, unparsed: it can be malformed, and the loop reports that back as the tool's result. */
  arguments: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AiToolCall[];
  /** On a `tool` message: which call it answers. */
  toolCallId?: string;
}

export interface AiToolDef {
  name: string;
  description: string;
  /** JSON Schema, handed to the model as written. */
  parameters: unknown;
}
