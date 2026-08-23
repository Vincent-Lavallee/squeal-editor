import * as t from '../../common/tokens';

export default function BusyDot() {
    return (
        <span
            data-testid="statusbar-assistant-busy"
            aria-hidden="true"
            style={{
                flex: 'none',
                width: 5,
                height: 5,
                borderRadius: t.RADIUS_PILL,
                background: t.ACCENT,
            }}
        />
    );
}
