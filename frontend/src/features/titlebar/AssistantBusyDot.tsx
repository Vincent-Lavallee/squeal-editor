import * as t from '../../common/tokens';

export default function AssistantBusyDot() {
    return (
        <span
            data-testid="titlebar-assistant-busy"
            aria-hidden="true"
            style={{
                position: 'absolute',
                top: 6,
                right: 4,
                width: 5,
                height: 5,
                borderRadius: t.RADIUS_PILL,
                background: t.ACCENT,
            }}
        />
    );
}
