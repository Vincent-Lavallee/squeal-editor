import DiagramCanvas from './DiagramCanvas.tsx';
import DiagramStatus from './DiagramStatus.tsx';
import DiagramToolbar from './DiagramToolbar.tsx';
import type { useDiagramCanvas } from './useDiagramCanvas.ts';

type DiagramViewProps = {
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
    loading: boolean;
    firstLoad: boolean;
    error: string | null;
    canvas: ReturnType<typeof useDiagramCanvas>;
    onRefresh: () => void;
    refreshChord: string;
};

export default function DiagramView({
    database,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
    loading,
    firstLoad,
    error,
    canvas,
    onRefresh,
    refreshChord,
}: DiagramViewProps) {
    return (
        <div
            data-testid="diagram"
            style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}
        >
            <DiagramToolbar
                database={database}
                databases={databases}
                onSelectDatabase={onSelectDatabase}
                pickerOpen={pickerOpen}
                onPickerOpenChange={onPickerOpenChange}
                nodeCount={canvas.layout.nodes.length}
                referenceCount={canvas.layout.edges.length}
                showCounts={!firstLoad && !error}
                zoom={canvas.zoom}
                setZoom={canvas.setZoom}
                stepZoom={canvas.stepZoom}
                loading={loading}
                onRefresh={onRefresh}
                refreshChord={refreshChord}
            />

            <DiagramStatus
                firstLoad={firstLoad}
                error={error}
                empty={canvas.layout.nodes.length === 0}
                database={database}
            />

            {!firstLoad && !error && canvas.layout.nodes.length > 0 && (
                <DiagramCanvas
                    scrollRef={canvas.scroll}
                    layout={canvas.layout}
                    placed={canvas.placed}
                    byKey={canvas.byKey}
                    extent={canvas.extent}
                    canvasWidth={canvas.canvasWidth}
                    canvasHeight={canvas.canvasHeight}
                    zoom={canvas.zoom}
                    hovered={canvas.hovered}
                    setHovered={canvas.setHovered}
                    dragging={canvas.dragging}
                    dragNode={canvas.dragNode}
                    panCanvas={canvas.panCanvas}
                />
            )}
        </div>
    );
}
