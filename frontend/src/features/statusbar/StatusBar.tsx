import { engineLabel } from '../../common/db/engines.ts';
import type { ExportTarget } from '../explorer/table-export/exportTarget.ts';
import { useSession } from '../../store/sessionSlice.ts';
import Badge from '../../common/components/Badge.tsx';
import * as t from '../../common/tokens';
import AssistantStatus from './AssistantStatus.tsx';
import DisconnectButton from './DisconnectButton.tsx';
import LostConnectionBanner from './LostConnectionBanner.tsx';
import ReadOnlyStatus from './ReadOnlyStatus.tsx';
import TableExportStatus from './TableExportStatus.tsx';
import { useQueryElapsed } from './hooks/useQueryElapsed.ts';

const segment: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    padding: `0 ${t.GAP}px`,
    borderLeft: `1px solid ${t.BORDER}`,
    color: t.TEXT_MUTED,
    fontSize: t.TEXT_BADGE,
};

interface Props {
    exporting: ExportTarget | null;
    onReopenExport: () => void;
}

export default function StatusBar({ exporting, onReopenExport }: Props) {
    const {
        connectionId,
        config,
        readOnly,
        environment,
        name,
        lostReason,
        setReadOnly,
        disconnect,
    } = useSession();
    const { queryRunning, queryElapsed } = useQueryElapsed();

    if (!connectionId || !environment) return null;

    return (
        <footer
            style={{
                display: 'flex',
                alignItems: 'center',
                flex: 'none',
                height: t.STATUSBAR_H,
                borderTop: `1px solid ${t.BORDER}`,
            }}
        >
            <DisconnectButton onDisconnect={() => disconnect()} />
            <span
                data-testid="statusbar-env"
                style={segment}
                title="The environment this connection is in"
            >
                {environment}
            </span>
            {queryRunning && <span style={segment}>Query running for {queryElapsed}s…</span>}
            {lostReason && <LostConnectionBanner lostReason={lostReason} />}
            <div style={{ flex: 1 }} />
            {exporting && <TableExportStatus table={exporting.table} onReopen={onReopenExport} />}
            <AssistantStatus />
            {config && (
                <Badge kind="neutral" style={{ margin: `0 ${t.GAP_XS}px 0 ${t.GAP}px` }}>
                    {engineLabel(config.type)}
                </Badge>
            )}
            <ReadOnlyStatus
                connectionId={connectionId}
                readOnly={readOnly}
                environment={environment}
                name={name}
                setReadOnly={setReadOnly}
            />
        </footer>
    );
}
