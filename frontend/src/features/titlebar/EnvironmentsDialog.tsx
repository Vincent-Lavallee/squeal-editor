import { useState } from 'react';

import { useEnvironments } from '../../store/environmentsSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Input from '../../common/components/Input.tsx';
import Modal from '../../common/components/Modal.tsx';
import * as t from '../../common/tokens';

const list: React.CSSProperties = { display: 'flex', flexDirection: 'column', margin: `0 0 ${t.GAP}px`, padding: 0, listStyle: 'none', border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, overflow: 'hidden' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: t.GAP_SM, padding: `${t.GAP_SM}px 10px` };

interface Props { onClose: () => void; }

/**
 * The File menu's "Environments…" screen: the whole surface for the picklist
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
    try { await add(trimmed); setName(''); } catch { /* error renders below */ }
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
          What a connection's Environment field offers, and what the connect screen groups by.
        </p>

        <ul style={list}>
          {environments.map((env, i) => (
            <li data-testid="env-row" key={env.id} style={{ ...row, ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}) }}>
              <span data-testid="env-name" style={{ flex: 1, fontSize: t.TEXT_BODY }}>{env.name}</span>
              {confirmingId === env.id ? (
                <>
                  <span style={{ color: t.TEXT_FAINT, fontFamily: t.FONT, fontSize: t.TEXT_BADGE }}>Delete?</span>
                  <Button variant="ghost" onClick={() => { remove(env.id); setConfirmingId(null); }}>Yes</Button>
                  <Button variant="ghost" onClick={() => setConfirmingId(null)}>No</Button>
                </>
              ) : (
                canDelete && <Button variant="ghost" onClick={() => setConfirmingId(env.id)}>Delete</Button>
              )}
            </li>
          ))}
        </ul>

        <form style={{ display: 'flex', gap: t.GAP_SM }} onSubmit={(e) => void handleAdd(e)}>
          <div style={{ flex: 1 }}>
            <Input value={name} placeholder="Staging" disabled={saving} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={saving || !name.trim()}>+ Add</Button>
        </form>

        {error && <Callout>{error}</Callout>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: t.GAP_XS }}>
          <Button onClick={close}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
