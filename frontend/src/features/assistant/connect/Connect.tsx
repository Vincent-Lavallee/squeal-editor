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

import Callout from '../../../common/components/Callout.tsx';
import Field from '../../../common/components/Field.tsx';
import Input from '../../../common/components/Input.tsx';
import Select from '../../../common/components/Select.tsx';
import * as t from '../../../common/tokens';
import {
    AI_PROVIDERS,
    type AiProvider,
    type AiStatus,
} from '../../../../../shared/protocol/index.ts';
import AiConnectActions from './AiConnectActions.tsx';
import AiConnectIntro from './AiConnectIntro.tsx';
import AiKeyStatusNotice from './AiKeyStatusNotice.tsx';

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
            <AiKeyStatusNotice status={status} />
            <AiConnectIntro />

            <Field label="Provider">
                <Select
                    data-testid="ai-provider-select"
                    value={provider}
                    options={AI_PROVIDERS.map((entry) => ({ value: entry.id, label: entry.label }))}
                    onSelect={(value) => setProvider(value as AiProvider)}
                />
            </Field>

            <Field label="API key" htmlFor="ai-key">
                {/* `password`, though nobody is shoulder-surfing a local editor: it is
            what stops the key being read back out of a screenshot or a screen
            share, which is how these actually leak. */}
                <Input
                    id="ai-key"
                    data-testid="ai-key"
                    type="password"
                    value={key}
                    placeholder={chosen.keyHint}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submit();
                    }}
                />
            </Field>

            <AiConnectActions
                provider={chosen}
                connecting={connecting}
                disabled={!key.trim() || connecting}
                onSubmit={submit}
            />

            {/* The provider's own words, not a rewrite of them: "this key is not
          funded" and "this key is not a key" are two different errands. */}
            {error ? <Callout>{error}</Callout> : null}
        </div>
    );
}
