import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';
import type { AiProviderInfo } from '../../../../shared/protocol/index.ts';

export default function AiConnectActions({
    provider,
    connecting,
    disabled,
    onSubmit,
}: {
    provider: AiProviderInfo;
    connecting: boolean;
    disabled: boolean;
    onSubmit: () => void;
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP }}>
            <Button
                variant="primary"
                onClick={onSubmit}
                disabled={disabled}
                data-testid="ai-connect-submit"
            >
                {connecting ? 'Checking…' : 'Connect'}
            </Button>
            <Button
                variant="ghost"
                onClick={() => void Neutralino.os.open(provider.keysUrl)}
                data-testid="ai-get-key"
            >
                Get a {provider.label} key
            </Button>
        </div>
    );
}
