import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './useDiagramZoomPan.ts';

export default function ZoomControls({
    zoom,
    setZoom,
    stepZoom,
}: {
    zoom: number;
    setZoom: (zoom: number) => void;
    stepZoom: (delta: number) => void;
}) {
    return (
        <>
            <Button
                variant="ghost"
                style={{ height: t.BUTTON_H_BAR, padding: `0 ${t.GAP_SM}px` }}
                onClick={() => stepZoom(-ZOOM_STEP)}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
                title="Zoom out"
            >
                −
            </Button>
            <Button
                variant="ghost"
                style={{ height: t.BUTTON_H_BAR, padding: `0 ${t.GAP_SM}px`, fontFamily: t.MONO }}
                onClick={() => setZoom(1)}
                title="Reset zoom"
            >
                {Math.round(zoom * 100)}%
            </Button>
            <Button
                variant="ghost"
                style={{ height: t.BUTTON_H_BAR, padding: `0 ${t.GAP_SM}px` }}
                onClick={() => stepZoom(ZOOM_STEP)}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
                title="Zoom in"
            >
                +
            </Button>
        </>
    );
}
