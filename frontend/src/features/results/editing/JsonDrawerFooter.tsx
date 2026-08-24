import Button from '../../../common/components/Button.tsx';
import * as t from '../../../common/tokens';

const footer: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_XS,
    flex: 'none',
    padding: t.GAP_SM,
    borderTop: `1px solid ${t.BORDER}`,
};

export default function JsonDrawerFooter({
    canNull,
    valid,
    onNull,
    onFormat,
    onCancel,
    onSave,
}: {
    canNull: boolean;
    valid: boolean;
    onNull: () => void;
    onFormat: () => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    return (
        <div style={footer}>
            {canNull && (
                <Button variant="ghost" onClick={onNull}>
                    Set NULL
                </Button>
            )}
            <Button variant="ghost" onClick={onFormat} disabled={!valid}>
                Format
            </Button>
            <div style={{ display: 'flex', gap: t.GAP_XS, marginLeft: 'auto' }}>
                <Button onClick={onCancel}>Cancel</Button>
                <Button
                    variant="primary"
                    data-testid="json-drawer-save"
                    onClick={onSave}
                    disabled={!valid}
                >
                    Save
                </Button>
            </div>
        </div>
    );
}
