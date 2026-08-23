import { useState } from 'react';

import { useEnvironments } from '../../store/environmentsSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Modal from '../../common/components/Modal.tsx';
import * as t from '../../common/tokens';
import AddEnvironmentForm from './AddEnvironmentForm.tsx';
import EnvironmentRow from './EnvironmentRow.tsx';

const list: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    margin: `0 0 ${t.GAP}px`,
    padding: 0,
    listStyle: 'none',
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    overflow: 'hidden',
};

interface Props {
    onClose: () => void;
}

/**
 * The File menu's "Environments" screen: the whole surface for the picklist
 * `ConnectionForm`'s "Environment" select offers and `SavedConnectionList`
 * groups by. Add and remove only, deliberately -- renaming is a different
 * feature (it would mean deciding what happens to connections already using
 * the old name, which "removed from the list" is written to avoid deciding).
 */
export default function EnvironmentsDialog({ onClose }: Props) {
    const { environments, saving, error, add, remove, dismissError } = useEnvironments();
    const [name, setName] = useState('');
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const canDelete = environments.length > 1;

    async function handleAdd(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        try {
            await add(trimmed);
            setName('');
        } catch {
            /* error renders below */
        }
    }

    function close(): void {
        dismissError();
        onClose();
    }

    return (
        <Modal onClose={close}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>Environments</h2>
                <p style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY }}>
                    What a connection&apos;s Environment field offers, and what the connect screen
                    groups by.
                </p>

                <ul style={list}>
                    {environments.map((env, i) => (
                        <EnvironmentRow
                            key={env.id}
                            env={env}
                            first={i === 0}
                            canDelete={canDelete}
                            confirming={confirmingId === env.id}
                            onConfirm={() => setConfirmingId(env.id)}
                            onRemove={() => {
                                remove(env.id);
                                setConfirmingId(null);
                            }}
                            onCancel={() => setConfirmingId(null)}
                        />
                    ))}
                </ul>

                <AddEnvironmentForm
                    name={name}
                    saving={saving}
                    onChange={setName}
                    onAdd={(e) => void handleAdd(e)}
                />

                {error && <Callout>{error}</Callout>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: t.GAP_XS }}>
                    <Button onClick={close}>Close</Button>
                </div>
            </div>
        </Modal>
    );
}
