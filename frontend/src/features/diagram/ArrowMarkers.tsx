import * as t from '../../common/tokens';

// One marker per colour: a marker cannot inherit the stroke of the path
// that references it, so the lit state needs its own.
export default function ArrowMarkers() {
    return (
        <defs>
            <marker
                id="diagram-arrow"
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3.5"
                orient="auto"
            >
                <path d="M0 0 L7 3.5 L0 7 z" fill={t.BORDER_STRONG} />
            </marker>
            <marker
                id="diagram-arrow-lit"
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3.5"
                orient="auto"
            >
                <path d="M0 0 L7 3.5 L0 7 z" fill={t.ACCENT} />
            </marker>
        </defs>
    );
}
