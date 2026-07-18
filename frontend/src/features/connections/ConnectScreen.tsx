import { useState } from 'react';

import type { PasswordUpdate, SavedConnection, Workspace } from '../../../../shared/protocol.ts';
import { useSession } from '../../store/sessionSlice.ts';
import ConnectionForm, { type FormValues } from './ConnectionForm.tsx';
import PasswordPrompt from './PasswordPrompt.tsx';
import SavedConnectionList from './SavedConnectionList.tsx';
import WorkspaceForm, { type WorkspaceFormValues } from './WorkspaceForm.tsx';
import WorkspacePicker from './WorkspacePicker.tsx';
import { useSavedConnections } from './useSavedConnections.ts';
import { useWorkspaces } from './useWorkspaces.ts';

/**
 * Every screen the way in can be on.
 *
 * The connection screens carry the workspace they are inside rather than reading
 * a "current workspace" from somewhere: which one you are in *is* which screen
 * you are on, and a second place holding that is a second thing to keep in step.
 */
type Screen =
  | { view: 'workspaces' }
  | { view: 'workspaceNew' }
  | { view: 'workspaceEdit'; workspace: Workspace }
  | { view: 'list'; workspaceId: string }
  | { view: 'new'; workspaceId: string }
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

interface Props {
  /**
   * The way back to what is already open, when anything is. Absent on the way
   * in, which is the case that has nothing to go back to.
   */
  onCancel?: () => void;
}

export default function ConnectScreen({ onCancel }: Props) {
  const saved = useSavedConnections();
  const workspaces = useWorkspaces();
  const session = useSession();

  const [screen, setScreen] = useState<Screen | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const loading = saved.loading || workspaces.loading;
  const only = workspaces.workspaces.length === 1 ? workspaces.workspaces[0] : undefined;

  /**
   * Null means "follow the data": with one workspace there is nothing to pick,
   * so the picker is skipped and the whole feature can be ignored -- and with
   * nothing saved in it there is no list worth showing, so the form *is* the
   * screen. Deriving it rather than pinning it at mount means the first load
   * settles on the right one without a flash.
   *
   * The picker is still reachable from the list's header, which is what keeps
   * skipping it from being a trap: a first-run user has to be able to get to the
   * screen that makes a second workspace.
   */
  const view: Screen =
    screen ??
    (only
      ? saved.connections.some((c) => c.workspaceId === only.id)
        ? { view: 'list', workspaceId: only.id }
        : { view: 'new', workspaceId: only.id }
      : { view: 'workspaces' });

  function go(next: Screen | null): void {
    // A previous attempt's error must not follow the user to the next screen.
    saved.dismissError();
    workspaces.dismissError();
    session.dismissError();
    setConnectingId(null);
    setScreen(next);
  }

  function pick(connection: SavedConnection): void {
    // An IAM connection stores no password and needs none -- the extension mints
    // a token at connect. Its `hasPassword` is false like a connection that just
    // did not save one, so `config.iam` is what tells "prompt for it" apart from
    // "there is nothing to prompt for".
    if (!connection.hasPassword && !connection.config.iam) return go({ view: 'password', connection });
    session.dismissError();
    setConnectingId(connection.id);
    void session.connectSaved(connection.id);
  }

  /** Named connections are saved before connecting, so a name clash stops here. */
  async function submitNew(workspaceId: string, values: FormValues): Promise<void> {
    if (values.name) {
      try {
        await saved.save({
          workspaceId,
          name: values.name,
          config: values.config,
          environment: values.environment,
          readOnly: values.readOnly,
          password: passwordUpdate(values, 'new'),
        });
      } catch {
        return; // Rendered from `saved.error`; connecting anyway would bury it.
      }
    }
    // The name, environment and read-only mode are the form's, not the store's:
    // this path covers the connection nobody saved, so there is no row to read
    // them back off. An unnamed one carries an empty name, and the rail falls
    // back to the server for it.
    void session.connect(
      { ...values.config, password: values.password },
      values.name,
      values.environment,
      values.readOnly
    );
  }

  async function submitEdit(connection: SavedConnection, values: FormValues): Promise<void> {
    try {
      await saved.save({
        id: connection.id,
        // An edit does not move a connection between workspaces: you got here
        // from inside one, and the form has no picker to say otherwise.
        workspaceId: connection.workspaceId,
        name: values.name,
        config: values.config,
        environment: values.environment,
        readOnly: values.readOnly,
        password: passwordUpdate(values, 'edit'),
      });
      go({ view: 'list', workspaceId: connection.workspaceId });
    } catch {
      // Rendered from `saved.error`; stay on the form so it can be corrected.
    }
  }

  async function submitWorkspace(id: string | undefined, values: WorkspaceFormValues): Promise<void> {
    try {
      const workspace = await workspaces.save({ id, ...values });
      // A new workspace is empty, so its list would be an empty box: go where
      // the user was heading anyway. An edit goes back to where it was opened.
      go(id ? { view: 'workspaces' } : { view: 'new', workspaceId: workspace.id });
    } catch {
      // Rendered from `workspaces.error`; stay on the form to correct it.
    }
  }

  const busy = session.connecting || saved.saving || workspaces.saving;
  const error = session.error ?? saved.error ?? workspaces.error;

  const workspaceById = (id: string): Workspace | undefined =>
    workspaces.workspaces.find((w) => w.id === id);

  /**
   * A screen inside a workspace that is no longer there falls back to the picker
   * rather than rendering an empty card. Resolved here rather than in each case,
   * so there is one answer to "the workspace is gone" instead of two that could
   * differ.
   */
  const resolved: Screen =
    (view.view === 'list' || view.view === 'new') && !workspaceById(view.workspaceId)
      ? { view: 'workspaces' }
      : view;

  function renderScreen() {
    if (loading) return <p className="note note--muted">Loading…</p>;

    switch (resolved.view) {
      case 'workspaces':
        return (
          <WorkspacePicker
            workspaces={workspaces.workspaces}
            countFor={(id) => saved.connections.filter((c) => c.workspaceId === id).length}
            busy={busy}
            onPick={(w) => go({ view: 'list', workspaceId: w.id })}
            onNew={() => go({ view: 'workspaceNew' })}
            onEdit={(w) => go({ view: 'workspaceEdit', workspace: w })}
            // Pinned before the delete lands, because `view` follows the data:
            // deleting the second-to-last workspace re-derives the launch screen
            // and would drop the user into the survivor's form mid-click.
            onDelete={(id) => {
              go({ view: 'workspaces' });
              workspaces.remove(id);
            }}
          />
        );

      case 'workspaceNew':
        return (
          <WorkspaceForm
            mode="new"
            busy={busy}
            onSubmit={(values) => void submitWorkspace(undefined, values)}
            onCancel={() => go({ view: 'workspaces' })}
          />
        );

      case 'workspaceEdit': {
        const { workspace } = resolved;
        return (
          <WorkspaceForm
            mode="edit"
            initial={workspace}
            busy={busy}
            onSubmit={(values) => void submitWorkspace(workspace.id, values)}
            onCancel={() => go({ view: 'workspaces' })}
          />
        );
      }

      case 'password': {
        const { connection } = resolved;
        return (
          <PasswordPrompt
            connection={connection}
            connecting={session.connecting}
            onSubmit={(password) => void session.connectSaved(connection.id, password)}
            onCancel={() => go({ view: 'list', workspaceId: connection.workspaceId })}
          />
        );
      }

      case 'edit': {
        const { connection } = resolved;
        return (
          <ConnectionForm
            mode="edit"
            initial={connection}
            busy={busy}
            onSubmit={(values) => void submitEdit(connection, values)}
            onCancel={() => go({ view: 'list', workspaceId: connection.workspaceId })}
          />
        );
      }

      case 'new': {
        const { workspaceId } = resolved;
        const populated = saved.connections.some((c) => c.workspaceId === workspaceId);

        return (
          <ConnectionForm
            mode="new"
            busy={busy}
            onSubmit={(values) => void submitNew(workspaceId, values)}
            // Nothing to go back to when the workspace is empty: its list would
            // be the empty box this form is standing in for.
            onCancel={populated ? () => go({ view: 'list', workspaceId }) : () => go({ view: 'workspaces' })}
          />
        );
      }

      case 'list': {
        // `resolved` guarantees this: a list whose workspace has gone became the
        // picker above.
        const workspace = workspaceById(resolved.workspaceId)!;

        return (
          <SavedConnectionList
            workspace={workspace}
            connections={saved.connections.filter((c) => c.workspaceId === workspace.id)}
            connectingId={session.connecting ? connectingId : null}
            busy={busy}
            onPick={pick}
            onEdit={(connection) => go({ view: 'edit', connection })}
            // Pinned for the same reason as the picker's: deleting the last
            // connection would otherwise re-derive this screen into the form.
            onDelete={(id) => {
              go({ view: 'list', workspaceId: workspace.id });
              saved.remove(id);
            }}
            onNew={() => go({ view: 'new', workspaceId: workspace.id })}
            onBack={() => go({ view: 'workspaces' })}
          />
        );
      }
    }
  }

  return (
    <div className="connect">
      <div className="card connect__card">
        <h1 className="connect__brand">Squeal</h1>
        <p className="connect__sub">A stupid simple SQL editor.</p>

        {/* One control, which is the route back *and* names where it goes --
            `.ws-bar`'s rule exactly, and for its reason: a title with a button
            beside it is two places naming one thing. */}
        {onCancel && (
          <button type="button" className="btn btn--ghost connect__back" onClick={onCancel}>
            ← Back to {session.name || session.serverLabel}
          </button>
        )}

        {renderScreen()}

        {error && <div className="callout--error connect__error">{error}</div>}
      </div>
    </div>
  );
}
