import { useState } from 'react';

import { useConnectionTransfer } from '../../store/transferSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Checkbox from '../../common/components/Checkbox.tsx';
import Modal from '../../common/components/Modal.tsx';
import * as t from '../../common/tokens';

interface Props {
    onClose: () => void;
}

const FILTERS = [{ name: 'Squeal connections', extensions: ['json'] }];
const DEFAULT_NAME = 'squeal-connections.json';

/**
 * The File menu's "Export connections": every workspace and every connection,
 * written to a file the user names.
 *
 * The save dialog is the OS's and the file is the extension's -- this screen
 * only decides whether the passwords go with it, which is the one question worth
 * asking before a path is chosen. See `db.saved.export` for why the document
 * never comes back through here.
 */
export default function ExportConnectionsDialog({ onClose }: Props) {
    const { busy, exported, error, exportTo, clear } = useConnectionTransfer();
    const [includePasswords, setIncludePasswords] = useState(false);

    async function choose(): Promise<void> {
        const path = await Neutralino.os.showSaveDialog('Export connections', {
            defaultPath: DEFAULT_NAME,
            filters: FILTERS,
        });
        // Cancelling resolves with an empty string rather than rejecting.
        if (!path) return;
        exportTo({ path, includePasswords });
    }

    function close(): void {
        clear();
        onClose();
    }

    return (
        <Modal onClose={close}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                    Export connections
                </h2>
                <p style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY }}>
                    Writes every workspace and every connection to one file, to carry to another
                    machine or keep as a backup.
                </p>

                <Checkbox
                    label="Include passwords"
                    hint="They leave the encrypted store and land in the file as plain text, readable by anyone who opens it."
                    checked={includePasswords}
                    disabled={busy}
                    onChange={(e) => setIncludePasswords(e.target.checked)}
                />

                {error && <Callout>{error}</Callout>}
                {exported && (
                    <Callout tone="success">
                        Exported {exported.connections}{' '}
                        {exported.connections === 1 ? 'connection' : 'connections'} in{' '}
                        {exported.workspaces}{' '}
                        {exported.workspaces === 1 ? 'workspace' : 'workspaces'}
                        {exported.passwords > 0
                            ? `, ${exported.passwords} carrying a password`
                            : ''}
                        .
                    </Callout>
                )}

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
                        {busy ? 'Exporting…' : 'Choose a file…'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
