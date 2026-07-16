import { useState } from 'react';

import type { PasswordUpdate, SavedConnection } from '../../../../shared/protocol.ts';
import { useSession } from '../../store/sessionSlice.ts';
import ConnectionForm, { type FormValues } from './ConnectionForm.tsx';
import PasswordPrompt from './PasswordPrompt.tsx';
import SavedConnectionList from './SavedConnectionList.tsx';
import { useSavedConnections } from './useSavedConnections.ts';

type Screen =
  | { view: 'list' }
  | { view: 'new' }
  | { view: 'edit'; connection: SavedConnection }
  | { view: 'password'; connection: SavedConnection };

/**
 * Turns what the form reported into what the store should do with the password.
 * `keep` exists for exactly one case: editing, with the field left alone.
 */
function passwordUpdate(values: FormValues, mode: 'new' | 'edit'): PasswordUpdate {
  if (!values.savePassword) return { mode: 'none' };
  if (mode === 'edit' && !values.passwordTouched) return { mode: 'keep' };
  return { mode: 'store', password: values.password };
}

export default function ConnectScreen() {
  const saved = useSavedConnections();
  const session = useSession();

  const [screen, setScreen] = useState<Screen | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  /**
   * Null means "follow the list": with nothing saved there is no list worth
   * showing, so the form *is* the screen. Deriving it rather than pinning it at
   * mount means the first load settles on the right one without a flash.
   */
  const view: Screen = screen ?? (saved.connections.length > 0 ? { view: 'list' } : { view: 'new' });

  function go(next: Screen | null): void {
    // A previous attempt's error must not follow the user to the next screen.
    saved.dismissError();
    session.dismissError();
    setConnectingId(null);
    setScreen(next);
  }

  function pick(connection: SavedConnection): void {
    if (!connection.hasPassword) return go({ view: 'password', connection });
    session.dismissError();
    setConnectingId(connection.id);
    void session.connectSaved(connection.id);
  }

  /** Named connections are saved before connecting, so a name clash stops here. */
  async function submitNew(values: FormValues): Promise<void> {
    if (values.name) {
      try {
        await saved.save({ name: values.name, config: values.config, password: passwordUpdate(values, 'new') });
      } catch {
        return; // Rendered from `saved.error`; connecting anyway would bury it.
      }
    }
    void session.connect({ ...values.config, password: values.password });
  }

  async function submitEdit(id: string, values: FormValues): Promise<void> {
    try {
      await saved.save({ id, name: values.name, config: values.config, password: passwordUpdate(values, 'edit') });
      go({ view: 'list' });
    } catch {
      // Rendered from `saved.error`; stay on the form so it can be corrected.
    }
  }

  const busy = session.connecting || saved.saving;
  const error = session.error ?? saved.error;

  return (
    <div className="connect">
      <div className="card connect__card">
        <h1 className="connect__brand">
          <span className="connect__mark">◆</span> Squeal
        </h1>
        <p className="connect__sub">A stupid simple SQL editor.</p>

        {saved.loading ? (
          <p className="note note--muted">Loading…</p>
        ) : view.view === 'list' ? (
          <SavedConnectionList
            connections={saved.connections}
            connectingId={session.connecting ? connectingId : null}
            busy={busy}
            onPick={pick}
            onEdit={(connection) => go({ view: 'edit', connection })}
            onDelete={saved.remove}
            onNew={() => go({ view: 'new' })}
          />
        ) : view.view === 'password' ? (
          <PasswordPrompt
            connection={view.connection}
            connecting={session.connecting}
            onSubmit={(password) => void session.connectSaved(view.connection.id, password)}
            onCancel={() => go({ view: 'list' })}
          />
        ) : view.view === 'edit' ? (
          <ConnectionForm
            mode="edit"
            initial={view.connection}
            busy={busy}
            onSubmit={(values) => void submitEdit(view.connection.id, values)}
            onCancel={() => go({ view: 'list' })}
          />
        ) : (
          <ConnectionForm
            mode="new"
            busy={busy}
            onSubmit={(values) => void submitNew(values)}
            // Nothing to go back to on a first run; the list is empty.
            onCancel={saved.connections.length > 0 ? () => go({ view: 'list' }) : undefined}
          />
        )}

        {error && <div className="callout--error connect__error">{error}</div>}
      </div>
    </div>
  );
}
