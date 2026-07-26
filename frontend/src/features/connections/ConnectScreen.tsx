import { useState } from 'react';

import type { PasswordUpdate, SavedConnection, Workspace } from '../../../../shared/protocol/index.ts';
import { useEnvironments } from '../../store/environmentsSlice.ts';
import { cancelConnect, useSession } from '../../store/sessionSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Skeleton from '../../common/components/Skeleton.tsx';
import * as t from '../../common/tokens';
import { isFileBased } from '../../common/db/engines.ts';
import ConnectionForm, { type FormValues } from './ConnectionForm.tsx';
import PasswordPrompt from './PasswordPrompt.tsx';
import SavedConnectionList, { connectPhaseLabel } from './SavedConnectionList.tsx';
import WorkspaceForm, { type WorkspaceFormValues } from './WorkspaceForm.tsx';
import WorkspacePicker from './WorkspacePicker.tsx';
import { useSavedConnections } from './useSavedConnections.ts';
import { useWorkspaces } from './useWorkspaces.ts';

type Screen =
  | { view: 'workspaces' } | { view: 'workspaceNew' } | { view: 'workspaceEdit'; workspace: Workspace }
  | { view: 'list'; workspaceId: string } | { view: 'new'; workspaceId: string }
  | { view: 'edit'; connection: SavedConnection } | { view: 'password'; connection: SavedConnection };

function passwordUpdate(values: FormValues, mode: 'new' | 'edit'): PasswordUpdate {
  if (!values.savePassword) return { mode: 'none' };
  if (mode === 'edit' && !values.passwordTouched) return { mode: 'keep' };
  return { mode: 'store', password: values.password };
}

interface Props { onCancel?: () => void; }

export default function ConnectScreen({ onCancel }: Props) {
  const saved = useSavedConnections();
  const workspaces = useWorkspaces();
  const environments = useEnvironments();
  const session = useSession();

  const [screen, setScreen] = useState<Screen | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const loading = saved.loading || workspaces.loading || environments.loading;
  const only = workspaces.workspaces.length === 1 ? workspaces.workspaces[0] : undefined;

  const view: Screen =
    screen ??
    (only
      ? saved.connections.some((c) => c.workspaceId === only.id)
        ? { view: 'list', workspaceId: only.id } : { view: 'new', workspaceId: only.id }
      : { view: 'workspaces' });

  function go(next: Screen | null): void {
    saved.dismissError(); workspaces.dismissError(); session.dismissError();
    setConnectingId(null); setScreen(next);
  }

  function pick(connection: SavedConnection): void {
    // `hasPassword` false means "prompt" only when there is a password to
    // prompt for. An IAM connection mints a token instead, and a file engine has
    // no auth at all -- for both, a prompt would ask for something that does not
    // exist and then refuse to connect without it.
    const needsPassword = !connection.config.iam && !isFileBased(connection.config.type);
    if (!connection.hasPassword && needsPassword) return go({ view: 'password', connection });
    session.dismissError(); setConnectingId(connection.id);
    void session.connectSaved(connection.id);
  }

  async function submitNew(workspaceId: string, values: FormValues): Promise<void> {
    let row: SavedConnection;
    try { row = await saved.save({ workspaceId, name: values.name, config: values.config, environment: values.environment, readOnly: values.readOnly, password: passwordUpdate(values, 'new'), color: values.color }); }
    catch { return; }
    void session.connect({ ...values.config, password: values.password }, values.name, values.environment, workspaceId, values.color, values.readOnly, row.id);
  }

  async function submitEdit(connection: SavedConnection, values: FormValues): Promise<void> {
    try { await saved.save({ id: connection.id, workspaceId: connection.workspaceId, name: values.name, config: values.config, environment: values.environment, readOnly: values.readOnly, password: passwordUpdate(values, 'edit'), color: values.color }); go({ view: 'list', workspaceId: connection.workspaceId }); }
    catch { /* stays on form */ }
  }

  async function submitWorkspace(id: string | undefined, values: WorkspaceFormValues): Promise<void> {
    try { const workspace = await workspaces.save({ id, ...values }); go(id ? { view: 'workspaces' } : { view: 'new', workspaceId: workspace.id }); }
    catch { /* stays on form */ }
  }

  const busy = session.connecting || saved.saving || workspaces.saving;
  const error = session.error ?? saved.error ?? workspaces.error ?? environments.error;
  const workspaceById = (id: string): Workspace | undefined => workspaces.workspaces.find((w) => w.id === id);

  const resolved: Screen =
    (view.view === 'list' || view.view === 'new') && !workspaceById(view.workspaceId) ? { view: 'workspaces' } : view;

  function renderScreen() {
    if (loading) return (
      <>
        <ConnectionListSkeleton />
        {session.connectingPhase && (
          <div style={{ marginTop: t.GAP, textAlign: 'center', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>
            {connectPhaseLabel(session.connectingPhase)}
          </div>
        )}
      </>
    );

    switch (resolved.view) {
      case 'workspaces':
        return <WorkspacePicker workspaces={workspaces.workspaces} countFor={(id) => saved.connections.filter((c) => c.workspaceId === id).length} busy={busy} onPick={(w) => go({ view: 'list', workspaceId: w.id })} onNew={() => go({ view: 'workspaceNew' })} onEdit={(w) => go({ view: 'workspaceEdit', workspace: w })} onDelete={(id) => { go({ view: 'workspaces' }); workspaces.remove(id); }} />;
      case 'workspaceNew':
        return <WorkspaceForm mode="new" busy={busy} onSubmit={(values) => void submitWorkspace(undefined, values)} onCancel={() => go({ view: 'workspaces' })} />;
      case 'workspaceEdit':
        return <WorkspaceForm mode="edit" initial={resolved.workspace} busy={busy} onSubmit={(values) => void submitWorkspace(resolved.workspace.id, values)} onCancel={() => go({ view: 'workspaces' })} />;
      case 'password':
        return <PasswordPrompt connection={resolved.connection} connecting={session.connecting} onSubmit={(password) => void session.connectSaved(resolved.connection.id, password)} onCancel={() => go({ view: 'list', workspaceId: resolved.connection.workspaceId })} />;
      case 'edit':
        return <ConnectionForm mode="edit" initial={resolved.connection} environments={environments.environments} busy={busy} onSubmit={(values) => void submitEdit(resolved.connection, values)} onCancel={() => go({ view: 'list', workspaceId: resolved.connection.workspaceId })} />;
      case 'new': {
        const populated = saved.connections.some((c) => c.workspaceId === resolved.workspaceId);
        return <ConnectionForm mode="new" environments={environments.environments} busy={busy} onSubmit={(values) => void submitNew(resolved.workspaceId, values)} onCancel={populated ? () => go({ view: 'list', workspaceId: resolved.workspaceId }) : () => go({ view: 'workspaces' })} />;
      }
      case 'list':
        return <SavedConnectionList workspace={workspaceById(resolved.workspaceId)!} connections={saved.connections.filter((c) => c.workspaceId === resolved.workspaceId)} environments={environments.environments} connectingId={session.connecting ? connectingId : null} connectingPhase={session.connectingPhase} busy={busy} onPick={pick} onEdit={(connection) => go({ view: 'edit', connection })} onDelete={(id) => { go({ view: 'list', workspaceId: resolved.workspaceId }); saved.remove(id); }} onNew={() => go({ view: 'new', workspaceId: resolved.workspaceId })} onBack={() => go({ view: 'workspaces' })} />;
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: t.GAP_XL }}>
      <div style={{ background: t.BG, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS_LG, padding: t.GAP_XL, width: 420 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, margin: 0, fontSize: t.TEXT_PAGE, fontWeight: 700, letterSpacing: '-0.01em' }}>Squeal</h1>
        <p style={{ margin: `4px 0 ${t.GAP_XL}px`, color: t.TEXT_MUTED }}>A stupid simple SQL editor.</p>

        {onCancel && (
          <Button variant="ghost" style={{ justifyContent: 'flex-start', width: '100%', marginBottom: t.GAP_LG }} onClick={onCancel}>
            ← Back to {session.name || session.serverLabel}
          </Button>
        )}

        {renderScreen()}

        {session.connecting && (
          <Button variant="ghost" style={{ justifyContent: 'center', width: '100%', marginTop: t.GAP_LG }} onClick={() => { cancelConnect(); go(null); }}>
            Cancel
          </Button>
        )}

        {error && <div style={{ marginTop: t.GAP_LG }}><Callout>{error}</Callout></div>}
      </div>
    </div>
  );
}

function ConnectionListSkeleton() {
  const rowH = 46;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, marginBottom: t.GAP_LG, padding: `${t.GAP_SM}px 10px`, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS }}>
        <Skeleton width={16} height={16} borderRadius={3} />
        <Skeleton width={16} height={16} borderRadius={3} />
        <Skeleton width={120} height={14} />
      </div>
      <Skeleton width={50} height={11} style={{ marginBottom: t.GAP_SM }} />
      <div style={{ border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, overflow: 'hidden' }}>
        {[0.6, 0.45, 0.55, 0.5, 0.65].map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, height: rowH, padding: '0 10px', ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}) }}>
            <Skeleton width={`${w * 100}%`} height={14} style={{ maxWidth: 220 }} />
            <Skeleton width={50} height={20} borderRadius={t.RADIUS_PILL} style={{ flex: 'none' }} />
          </div>
        ))}
      </div>
      <Skeleton width="100%" height={t.BUTTON_H} style={{ marginTop: t.GAP }} />
    </>
  );
}
