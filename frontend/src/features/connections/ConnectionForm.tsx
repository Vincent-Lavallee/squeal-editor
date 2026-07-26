import { useState } from 'react';

import type { ConnectionColorId, EngineType, Environment, EnvironmentDef, SavedConnection, ServerConfig } from '../../../../shared/protocol/index.ts';
import { ENGINES, engineByType, isFileBased } from '../../common/db/engines.ts';
import { CONNECTION_COLORS, DEFAULT_CONNECTION_COLOR } from '../../common/icons/connectionColors.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Select from '../../common/components/Select.tsx';
import Field from '../../common/components/Field.tsx';
import SrOnly from '../../common/components/SrOnly.tsx';
import * as t from '../../common/tokens';

export interface FormValues {
  name: string;
  config: ServerConfig;
  environment: Environment;
  readOnly: boolean;
  password: string;
  savePassword: boolean;
  passwordTouched: boolean;
  color: ConnectionColorId;
}

interface Props {
  mode: 'new' | 'edit';
  initial?: SavedConnection;
  environments: EnvironmentDef[];
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
  busy: boolean;
}

type AuthMethod = 'password' | 'iam';

interface FormState {
  name: string;
  type: EngineType;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  environment: Environment;
  ssl: boolean;
  readOnly: boolean;
  savePassword: boolean;
  passwordTouched: boolean;
  authMethod: AuthMethod;
  awsProfile: string;
  awsRegion: string;
  color: ConnectionColorId;
}

// Matches the shipped default environment's own name, which is the only name
// this can know without a policy of what a team calls its production tier. A
// renamed or custom "prod-like" environment simply does not get the default --
// the cost of naming freedom, not a bug.
const readOnlyDefault = (environment: Environment): boolean => environment === 'production';

const checkboxStyle = { flex: 'none', width: 13, height: 13, margin: 0, accentColor: t.ACCENT, cursor: 'pointer' };
const checkboxHintStyle = { marginLeft: 13 + t.GAP_SM, marginTop: 2, color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE };

const hiddenRadio: React.CSSProperties = { position: 'absolute', opacity: 0, pointerEvents: 'none' };
const pickBase: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 34, height: 34, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, cursor: 'pointer' };

function initialState(initial: SavedConnection | undefined, defaultEnvironment: string): FormState {
  if (!initial) {
    return {
      name: '', type: 'postgres', host: 'localhost', port: '', user: '', password: '', database: '',
      environment: defaultEnvironment, ssl: false, readOnly: readOnlyDefault(defaultEnvironment),
      savePassword: true, passwordTouched: false, authMethod: 'password', awsProfile: '', awsRegion: '',
      color: DEFAULT_CONNECTION_COLOR,
    };
  }
  return {
    name: initial.name, type: initial.config.type, host: initial.config.host,
    port: String(initial.config.port), user: initial.config.user, database: initial.config.database ?? '',
    environment: initial.environment, ssl: initial.config.ssl ?? false, readOnly: initial.readOnly,
    password: '', savePassword: initial.hasPassword, passwordTouched: false,
    authMethod: initial.config.iam ? 'iam' : 'password',
    awsProfile: initial.config.iam?.profile ?? '', awsRegion: initial.config.iam?.region ?? '',
    color: initial.color,
  };
}

export default function ConnectionForm({ mode, initial, environments, onSubmit, onCancel, busy }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(initial, environments[0]?.name ?? ''));
  const engine = engineByType(form.type);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const named = form.name.trim() !== '';
  const willBeStored = mode === 'edit' || named;
  const fileBased = isFileBased(form.type);
  // A file has no auth of any kind, so IAM cannot be in play even if the select
  // was left on it before the engine changed.
  const iam = !fileBased && form.authMethod === 'iam';
  const passwordUsed = mode === 'new' || form.savePassword;

  function setAuthMethod(method: AuthMethod): void {
    setForm((prev) => ({ ...prev, authMethod: method, ssl: method === 'iam' ? true : prev.ssl }));
  }

  /**
   * Switching between a server engine and a file engine clears the address,
   * because `database` means a different thing on each side of that line -- a
   * database name over there, a path to a file here. Carrying `postgres` across
   * would offer it as a filename.
   */
  function setEngine(type: EngineType): void {
    setForm((prev) => (isFileBased(prev.type) === isFileBased(type) ? { ...prev, type } : { ...prev, type, database: '' }));
  }

  async function browseForFile(): Promise<void> {
    const chosen = await Neutralino.os.showOpenDialog('Choose a SQLite database', {
      multiSelections: false,
      filters: [
        { name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    // An empty array is the user cancelling, which must leave the field alone
    // rather than blanking a path they had already chosen.
    if (chosen.length > 0) set('database', chosen[0]!);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSubmit({
      name: form.name.trim(),
      config: fileBased
        ? // No server to address and no secret to carry: the empty host, zero port
          // and empty user are what `ServerConfig` documents a file engine writes,
          // and the path travels as `database`.
          { type: form.type, host: '', port: 0, user: '', database: form.database.trim() }
        : {
            type: form.type, host: form.host, port: Number(form.port) || engine.defaultPort,
            user: form.user || engine.defaultUser, database: form.database || undefined,
            ssl: iam ? true : form.ssl,
            ...(iam ? { iam: { profile: form.awsProfile.trim(), region: form.awsRegion.trim() } } : {}),
          },
      environment: form.environment, readOnly: form.readOnly,
      password: iam || fileBased ? '' : form.password,
      savePassword: iam || fileBased ? false : willBeStored && form.savePassword,
      passwordTouched: fileBased ? false : form.passwordTouched,
      color: form.color,
    });
  }

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }} onSubmit={handleSubmit}>
      <Field label="Name" htmlFor="name" hint="(required)">
        <Input id="name" value={form.name} autoFocus placeholder={mode === 'edit' ? '' : 'prod-analytics'} required
          onChange={(e) => set('name', e.target.value)} />
      </Field>

      <Field label="Environment" htmlFor="environment">
        <Select id="environment" value={form.environment}
          options={environments.map((env) => ({ value: env.name, label: env.name }))}
          onSelect={(value) => {
            const env = value as Environment;
            setForm((prev) => ({ ...prev, environment: env, readOnly: readOnlyDefault(env) }));
          }} />
      </Field>

      <Field label="Colour">
        {/* `nowrap` plus a tightened gap keeps all nine swatches on one line at
            the form's fixed 420px width -- the default GAP_SM gap left exactly
            enough room for the tenth tile this picker used to have, and wrapping
            the last one to its own row read as broken rather than deliberate. */}
        <div style={{ display: 'flex', flexWrap: 'nowrap', gap: t.GAP_XS }} role="radiogroup" aria-label="Colour">
          {CONNECTION_COLORS.map(({ id, value: hex }) => {
            const on = form.color === id;
            return (
              <label key={id} style={{ ...pickBase, ...(on ? { borderColor: t.ACCENT, background: t.SELECTED } : {}) }}>
                <input type="radio" name="connection-color" value={id} checked={on} onChange={() => set('color', id)} style={hiddenRadio} />
                <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: t.RADIUS_PILL, background: hex }} />
                <SrOnly>{id}</SrOnly>
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="">
        <div style={{ marginTop: t.GAP_XS }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, cursor: 'pointer' }} htmlFor="readOnly">
            <input id="readOnly" type="checkbox" checked={form.readOnly} onChange={(e) => set('readOnly', e.target.checked)} style={checkboxStyle} />
            Open read-only
          </label>
          <div style={checkboxHintStyle}>the server refuses writes; on by default for Production</div>
        </div>
      </Field>

      <Field label="Engine" htmlFor="type">
        <Select id="type" value={form.type} onSelect={(value) => setEngine(value as EngineType)}
          options={ENGINES.map((e) => ({ value: e.value, label: e.label }))} />
      </Field>

      {!fileBased && (
      <Field label="Authentication" htmlFor="authMethod">
        <Select id="authMethod" value={form.authMethod} onSelect={(value) => setAuthMethod(value as AuthMethod)}
          options={[{ value: 'password', label: 'Password' }, { value: 'iam', label: 'AWS IAM (RDS)' }]} />
      </Field>
      )}

      {!fileBased && (
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Field label="Host" htmlFor="host">
            <Input id="host" value={form.host} onChange={(e) => set('host', e.target.value)} />
          </Field>
        </div>
        <div style={{ width: 90 }}>
          <Field label="Port" htmlFor="port">
            <Input id="port" value={form.port} placeholder={String(engine.defaultPort)} onChange={(e) => set('port', e.target.value)} />
          </Field>
        </div>
      </div>
      )}

      {!fileBased && (
      <Field label="">
        <div style={{ marginTop: t.GAP_XS }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, cursor: 'pointer' }} htmlFor="ssl">
            <input id="ssl" type="checkbox" checked={iam ? true : form.ssl} disabled={iam} onChange={(e) => set('ssl', e.target.checked)} style={checkboxStyle} />
            Connect over SSL
          </label>
          <div style={checkboxHintStyle}>
            {iam ? 'required for IAM authentication' : "the server's certificate must be one this machine trusts"}
          </div>
        </div>
      </Field>
      )}

      {!fileBased && (
      <Field label="User" htmlFor="user">
        <Input id="user" value={form.user} placeholder={engine.defaultUser} onChange={(e) => set('user', e.target.value)} />
      </Field>
      )}

      {!fileBased && !iam && (
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" value={form.password} disabled={!passwordUsed}
            placeholder={mode === 'edit' && initial?.hasPassword ? 'unchanged' : ''}
            onChange={(e) => { set('password', e.target.value); set('passwordTouched', true); }} />
          {willBeStored && (
            <div style={{ marginTop: t.GAP_XS }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, cursor: 'pointer' }} htmlFor="savePassword">
                <input id="savePassword" type="checkbox" checked={form.savePassword} onChange={(e) => set('savePassword', e.target.checked)} style={checkboxStyle} />
                Save the password
              </label>
              <div style={checkboxHintStyle}>otherwise you are asked for it each time</div>
            </div>
          )}
        </Field>
      )}

      {iam && (
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="AWS profile" htmlFor="awsProfile">
            <Input id="awsProfile" value={form.awsProfile} placeholder="default" required onChange={(e) => set('awsProfile', e.target.value)} />
          </Field>
          <Field label="Region" htmlFor="awsRegion">
            <Input id="awsRegion" value={form.awsRegion} placeholder="us-east-1" required onChange={(e) => set('awsRegion', e.target.value)} />
          </Field>
        </div>
      )}

      {fileBased ? (
        <Field label="Database file" htmlFor="database" hint="(required)">
          <div style={{ display: 'flex', gap: t.GAP_SM }}>
            <div style={{ flex: 1 }}>
              <Input id="database" value={form.database} placeholder="C:\path\to\app.db" required
                onChange={(e) => set('database', e.target.value)} />
            </div>
            {/* Typing or pasting a path stays possible beside the dialog: when you
                already have the path, that is the shorter route to it. */}
            <Button onClick={() => void browseForFile()} disabled={busy}>Browse…</Button>
          </div>
        </Field>
      ) : (
        <Field label="Database" htmlFor="database" hint={form.type === 'postgres' ? '(default: postgres)' : '(optional)'}>
          <Input id="database" value={form.database} onChange={(e) => set('database', e.target.value)} />
        </Field>
      )}

      <div data-testid="connect-actions" style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button type="submit" data-testid="connect-submit" variant="primary" style={{ justifyContent: 'center', height: 34, flex: 1 }} disabled={busy || !form.name.trim() || (fileBased && !form.database.trim())}>
          {mode === 'edit' ? (busy ? 'Saving…' : 'Save changes') : busy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </form>
  );
}
