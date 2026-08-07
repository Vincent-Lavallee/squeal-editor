/**
 * Pick a provider, paste a key.
 *
 * `AiStatus` resolves rather than rejecting so this can tell "nothing stored
 * yet" from "the keychain would not answer": the second one draws a callout
 * naming what the OS said, because a key that cannot be *read* is not a key that
 * needs re-pasting, and offering the same form for both would send the user
 * round a loop that cannot end.
 *
 * The form is offered in either case. When the keychain is broken, pasting again
 * is still the only move available from here, and a screen with nothing on it
 * but bad news is worse than one that lets you try.
 */

import { useState } from 'react';

import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Field from '../../common/components/Field.tsx';
import Input from '../../common/components/Input.tsx';
import Select from '../../common/components/Select.tsx';
import * as t from '../../common/tokens';
import { AI_PROVIDERS, type AiProvider, type AiStatus } from '../../../../shared/protocol/index.ts';

interface Props {
  status: AiStatus;
  connecting: boolean;
  error: string | null;
  onConnect: (provider: AiProvider, key: string) => void;
}

const wrap = {
  display: 'flex',
  flexDirection: 'column',
  gap: t.GAP_LG,
  padding: t.GAP_XL,
  fontSize: t.TEXT_BODY,
  color: t.TEXT_MUTED,
} as const;

export default function Connect({ status, connecting, error, onConnect }: Props) {
  const [provider, setProvider] = useState<AiProvider>(status.provider ?? AI_PROVIDERS[0].id);
  const [key, setKey] = useState('');

  const chosen = AI_PROVIDERS.find((entry) => entry.id === provider) ?? AI_PROVIDERS[0];
  const submit = () => {
    if (key.trim() && !connecting) onConnect(provider, key.trim());
  };

  return (
    <div style={wrap} data-testid="ai-connect">
      {status.state === 'unavailable' ? (
        <Callout>
          The stored key could not be read.
          {status.reason ? <div style={{ marginTop: t.GAP_SM, fontFamily: t.MONO, wordBreak: 'break-word' }}>{status.reason}</div> : null}
        </Callout>
      ) : null}

      <p>Bring your own API key. It is kept in this machine&rsquo;s keychain, and the requests go straight from this app to the provider — nothing passes through anyone else.</p>

      {/* Said before they go looking, not after they come back empty-handed: the
          two are sold under the same brand and only one of them has an API key
          behind it, which is the single most likely way this screen wastes
          somebody's afternoon. */}
      <p style={{ color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>
        This needs a <em>developer API key</em>, billed per token. A ChatGPT Plus or Claude Pro subscription is a different product and does not include one.
      </p>

      <Field label="Provider">
        <Select data-testid="ai-provider-select" value={provider}
          options={AI_PROVIDERS.map((entry) => ({ value: entry.id, label: entry.label }))}
          onSelect={(value) => setProvider(value as AiProvider)} />
      </Field>

      <Field label="API key" htmlFor="ai-key">
        {/* `password`, though nobody is shoulder-surfing a local editor: it is
            what stops the key being read back out of a screenshot or a screen
            share, which is how these actually leak. */}
        <Input id="ai-key" data-testid="ai-key" type="password" value={key} placeholder={chosen.keyHint}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }} />
      </Field>

      <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP }}>
        <Button variant="primary" onClick={submit} disabled={!key.trim() || connecting} data-testid="ai-connect-submit">
          {connecting ? 'Checking…' : 'Connect'}
        </Button>
        <Button variant="ghost" onClick={() => void Neutralino.os.open(chosen.keysUrl)} data-testid="ai-get-key">
          Get a {chosen.label} key
        </Button>
      </div>

      {/* The provider's own words, not a rewrite of them: "this key is not
          funded" and "this key is not a key" are two different errands. */}
      {error ? <Callout>{error}</Callout> : null}
    </div>
  );
}
