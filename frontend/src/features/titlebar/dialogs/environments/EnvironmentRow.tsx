import Button from '../../../../common/components/Button.tsx';
import * as t from '../../../../common/tokens';

const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    padding: `${t.GAP_SM}px 10px`,
};

export default function EnvironmentRow({
    env,
    first,
    canDelete,
    confirming,
    onConfirm,
    onRemove,
    onCancel,
}: {
    env: { id: string; name: string };
    first: boolean;
    canDelete: boolean;
    confirming: boolean;
    onConfirm: () => void;
    onRemove: () => void;
    onCancel: () => void;
}) {
    return (
        <li
            data-testid="env-row"
            style={{ ...row, ...(first ? {} : { borderTop: `1px solid ${t.BORDER}` }) }}
        >
            <span data-testid="env-name" style={{ flex: 1, fontSize: t.TEXT_BODY }}>
                {env.name}
            </span>
            {confirming ? (
                <>
                    <span
                        style={{ color: t.TEXT_FAINT, fontFamily: t.FONT, fontSize: t.TEXT_BADGE }}
                    >
                        Delete?
                    </span>
                    <Button variant="ghost" onClick={onRemove}>
                        Yes
                    </Button>
                    <Button variant="ghost" onClick={onCancel}>
                        No
                    </Button>
                </>
            ) : (
                canDelete && (
                    <Button variant="ghost" onClick={onConfirm}>
                        Delete
                    </Button>
                )
            )}
        </li>
    );
}
