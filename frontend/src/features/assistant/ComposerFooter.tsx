import Select from '../../common/components/Select.tsx';
import * as t from '../../common/tokens';
import type { useAssistantAccount } from '../../store/assistantSlice.ts';
import type { AiApprovalMode } from '../../../../shared/protocol/index.ts';

const MODES: { value: AiApprovalMode; label: string; hint: string }[] = [
    {
        value: 'manual',
        label: 'Ask every time',
        hint: 'Every query it wants to run stops for you.',
    },
    {
        value: 'auto',
        label: 'Auto-approve',
        hint: 'It runs queries without asking — except on a production connection.',
    },
    { value: 'bypass', label: 'Bypass', hint: 'Nothing stops it, production included.' },
];

const footerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    minWidth: 0,
};

export default function ComposerFooter({
    account,
}: {
    account: ReturnType<typeof useAssistantAccount>;
}) {
    return (
        <div style={footerStyle}>
            {account.models.length ? (
                <div style={{ flex: '0 1 auto', minWidth: 0, maxWidth: 240 }}>
                    <Select
                        variant="bare"
                        searchable
                        align="start"
                        data-testid="ai-model-select"
                        value={account.model ?? ''}
                        options={account.models.map((model) => ({
                            value: model.id,
                            label: model.name,
                        }))}
                        onSelect={account.chooseModel}
                    />
                </div>
            ) : null}

            <div style={{ flex: 1, minWidth: 0 }} />

            <div style={{ flex: 'none', width: 132 }}>
                <Select
                    variant="bare"
                    align="end"
                    data-testid="ai-mode-select"
                    value={account.mode}
                    options={MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                    onSelect={(value) => account.setMode(value as AiApprovalMode)}
                    title={MODES.find((mode) => mode.value === account.mode)?.hint}
                />
            </div>
        </div>
    );
}
