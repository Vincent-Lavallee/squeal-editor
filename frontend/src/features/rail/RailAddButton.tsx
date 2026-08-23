import SrOnly from '../../common/components/SrOnly.tsx';
import * as t from '../../common/tokens';

interface Props {
    onAdd: () => void;
}

export default function RailAddButton({ onAdd }: Props) {
    return (
        <button
            type="button"
            data-testid="rail-add"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
                alignSelf: 'center',
                width: t.BUTTON_H_BAR,
                height: t.BUTTON_H_BAR,
                marginLeft: 'auto',
                border: `1px solid ${t.BORDER_STRONG}`,
                borderRadius: t.RADIUS,
                background: 'none',
                color: t.TEXT_MUTED,
                fontSize: 16,
                lineHeight: 1,
                cursor: 'pointer',
            }}
            onClick={onAdd}
            title="Open another connection"
        >
            <span aria-hidden="true">+</span>
            <SrOnly>Open another connection</SrOnly>
        </button>
    );
}
