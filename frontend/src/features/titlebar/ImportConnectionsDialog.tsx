import type { ConnectionImportSummary } from '../../../../shared/protocol/index.ts';
import { useConnectionTransfer } from '../../store/transferSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Modal from '../../common/components/Modal.tsx';
import * as t from '../../common/tokens';

interface Props {
    onClose: () => void;
}

const FILTERS = [{ name: 'Squeal connections', extensions: ['json'] }];

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * What the merge did, in the terms it was made: added and updated are separate
 * clauses because they are separate claims, and a clause for a count of zero is
 * left out rather than written as "0 updated".
 */
function summarise(summary: ConnectionImportSummary): string {
    const parts = [
        summary.connectionsAdded > 0 && `${plural(summary.connectionsAdded, 'connection')} added`,
        summary.connectionsUpdated > 0 && `${summary.connectionsUpdated} updated`,
        summary.workspacesAdded > 0 && `${plural(summary.workspacesAdded, 'workspace')} added`,
        summary.passwords > 0 && `${plural(summary.passwords, 'password')} stored`,
    ].filter((part): part is string => part !== false);

    return parts.length > 0 ? `${parts.join(', ')}.` : 'That file described no connections.';
}

/**
 * The File menu's "Import connections": a file written by the export beside it,
 * merged into what is already here.
 *
 * The file picker is the OS's and the reading is the extension's, for the export's
 * reason in reverse -- the file may carry plain-text passwords, so the side that
 * owns the encrypted store is the side that opens it.
 */
export default function ImportConnectionsDialog({ onClose }: Props) {
    const { busy, imported, error, importFrom, clear } = useConnectionTransfer();

    async function choose(): Promise<void> {
        const chosen = await Neutralino.os.showOpenDialog('Import connections', {
            filters: FILTERS,
        });
        // Cancelling resolves with an empty array rather than rejecting.
        if (chosen.length === 0) return;
        importFrom(chosen[0]!);
    }

    function close(): void {
        clear();
        onClose();
    }

    return (
        <Modal onClose={close}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                    Import connections
                </h2>
                <p style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY }}>
                    Merges a file written by <em>Export connections</em> into what you already have.
                    A connection the file and this app both hold is updated in place; everything
                    else is added, and nothing is removed.
                </p>
                <p style={{ margin: 0, color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>
                    A connection whose password the file does not carry asks for one when you
                    connect to it.
                </p>

                {error && <Callout>{error}</Callout>}
                {imported && <Callout tone="success">{summarise(imported)}</Callout>}

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: t.GAP_SM,
                        marginTop: t.GAP_XS,
                    }}
                >
                    <Button onClick={close}>Close</Button>
                    <Button variant="primary" disabled={busy} onClick={() => void choose()}>
                        {busy ? 'Importing…' : 'Choose a file…'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
