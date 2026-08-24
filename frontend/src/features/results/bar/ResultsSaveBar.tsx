import Button from '../../../common/components/Button.tsx';
import * as t from '../../../common/tokens';

const barStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    flex: 'none',
    padding: `0 ${t.GAP_LG}px`,
    height: 34,
    borderBottom: `1px solid ${t.BORDER}`,
    fontSize: t.TEXT_BADGE,
    color: t.TEXT_MUTED,
};

interface Props {
    dirtyCount: number;
    saving: boolean;
    saveError: string | null;
    onDiscard: () => void;
    onSave: () => void;
}

export default function ResultsSaveBar({
    dirtyCount,
    saving,
    saveError,
    onDiscard,
    onSave,
}: Props) {
    return (
        <div data-testid="results-savebar" style={barStyle}>
            <span style={saveError ? { color: t.RED_TEXT } : undefined}>
                {saveError ?? `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}
            </span>
            <div
                data-testid="results-save-actions"
                style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, marginLeft: 'auto' }}
            >
                <Button
                    variant="ghost"
                    style={{ height: 24, padding: '0 10px' }}
                    onClick={onDiscard}
                    disabled={saving}
                >
                    Discard
                </Button>
                <Button
                    variant="primary"
                    style={{ height: 24, padding: '0 10px' }}
                    onClick={onSave}
                    disabled={saving || dirtyCount === 0}
                >
                    {saving ? 'Saving…' : 'Save'}
                </Button>
            </div>
        </div>
    );
}
