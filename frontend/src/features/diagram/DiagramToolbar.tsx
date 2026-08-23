import * as t from '../../common/tokens';
import DatabasePicker from './DatabasePicker.tsx';
import NodeCounts from './NodeCounts.tsx';
import RefreshButton from './RefreshButton.tsx';
import ZoomControls from './ZoomControls.tsx';

type DiagramToolbarProps = {
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
    nodeCount: number;
    referenceCount: number;
    showCounts: boolean;
    zoom: number;
    setZoom: (zoom: number) => void;
    stepZoom: (delta: number) => void;
    loading: boolean;
    onRefresh: () => void;
    refreshChord: string;
};

export default function DiagramToolbar({
    database,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
    nodeCount,
    referenceCount,
    showCounts,
    zoom,
    setZoom,
    stepZoom,
    loading,
    onRefresh,
    refreshChord,
}: DiagramToolbarProps) {
    return (
        // The editor's toolbar shape at the same height: the database this
        // diagram is *of* at the far left, actions at the right. It is the
        // sidebar header's picker rather than the editor's caret, because there
        // is no loud primary control here to hang a caret off and because this
        // select *names what you are looking at*, which is what `bare` is for.
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_SM,
                flex: 'none',
                height: t.TAB_H,
                padding: `0 ${t.GAP_SM}px`,
                borderBottom: `1px solid ${t.BORDER}`,
            }}
        >
            <DatabasePicker
                database={database}
                databases={databases}
                onSelectDatabase={onSelectDatabase}
                pickerOpen={pickerOpen}
                onPickerOpenChange={onPickerOpenChange}
            />
            {showCounts && <NodeCounts nodeCount={nodeCount} referenceCount={referenceCount} />}
            <div style={{ flex: 1 }} />
            <ZoomControls zoom={zoom} setZoom={setZoom} stepZoom={stepZoom} />
            <RefreshButton
                loading={loading}
                disabled={loading || !database}
                onRefresh={onRefresh}
                refreshChord={refreshChord}
            />
        </div>
    );
}
