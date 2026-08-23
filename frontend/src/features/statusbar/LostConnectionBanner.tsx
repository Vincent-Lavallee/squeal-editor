import * as t from '../../common/tokens';

const segment: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    padding: `0 ${t.GAP}px`,
    borderLeft: `1px solid ${t.BORDER}`,
    color: t.TEXT_MUTED,
    fontSize: t.TEXT_BADGE,
};

/**
 * AMBER rather than RED: nothing has failed and nothing needs doing. The
 * server hung up, the next query opens a new connection by itself, and the
 * only reason to say so at all is that a query which takes an extra beat
 * should not read as a slow database.
 */
export default function LostConnectionBanner({ lostReason }: { lostReason: string }) {
    return (
        <span
            data-testid="statusbar-lost"
            style={{ ...segment, color: t.AMBER }}
            title={`${lostReason} The next query will reconnect.`}
        >
            Connection dropped — reconnects on the next query
        </span>
    );
}
