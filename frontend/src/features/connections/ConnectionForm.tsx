import { useState } from 'react';

import type { EngineType, Environment, SavedConnection, ServerConfig } from '../../../../shared/protocol/index.ts';
import { ENGINES, engineByType } from '../../common/db/engines.ts';
import { DEFAULT_ENVIRONMENT, ENVIRONMENTS } from '../../common/db/environments.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Select from '../../common/components/Select.tsx';
import Field from '../../common/components/Field.tsx';
import * as t from '../../common/tokens';

export interface FormValues {
  name: string;
  config: ServerConfig;
  environment: Environment;
  readOnly: boolean;
  password: string;
  savePassword: boolean;
  passwordTouched: boolean;
}

interface Props {
  mode: 'new' | 'edit';
  initial?: SavedConnection;
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
}

const readOnlyDefault = (environment: Environment): boolean => environment === 'production';

const checkboxStyle = { flex: 'none', width: 13, height: 13, margin: 0, accentColor: t.ACCENT, cursor: 'pointer' };

function initialState(initial?: SavedConnection): FormState {
  if (!initial) {
    return {
      name: '', type: 'postgres', host: 'localhost', port: '', user: '', password: '', database: '',
      environment: DEFAULT_ENVIRONMENT, ssl: false, readOnly: readOnlyDefault(DEFAULT_ENVIRONMENT),
      savePassword: true, passwordTouched: false, authMethod: 'password', awsProfile: '', awsRegion: '',
    };
  }
  return {
    name: initial.name, type: initial.config.type, host: initial.config.host,
    port: String(initial.config.port), user: initial.config.user, database: initial.config.database ?? '',
    environment: initial.environment, ssl: initial.config.ssl ?? false, readOnly: initial.readOnly,
    password: '', savePassword: initial.hasPassword, passwordTouched: false,
    authMethod: initial.config.iam ? 'iam' : 'password',
    awsProfile: initial.config.iam?.profile ?? '', awsRegion: initial.config.iam?.region ?? '',
  };
}

export default function ConnectionForm({ mode, initial, onSubmit, onCancel, busy }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(initial));
  const engine = engineByType(form.type);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const named = form.name.trim() !== '';
  const willBeStored = mode === 'edit' || named;
  const iam = form.authMethod === 'iam';
  const passwordUsed = mode === 'new' || form.savePassword;

  function setAuthMethod(method: AuthMethod): void {
    setForm((prev) => ({ ...prev, authMethod: method, ssl: method === 'iam' ? true : prev.ssl }));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSubmit({
      name: form.name.trim(),
      config: {
        type: form.type, host: form.host, port: Number(form.port) || engine.defaultPort,
        user: form.user || engine.defaultUser, database: form.database || undefined,
        ssl: iam ? true : form.ssl,
        ...(iam ? { iam: { profile: form.awsProfile.trim(), region: form.awsRegion.trim() } } : {}),
      },
      environment: form.environment, readOnly: form.readOnly,
      password: iam ? '' : form.password,
      savePassword: iam ? false : willBeStored && form.savePassword,
      passwordTouched: form.passwordTouched,
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
          onChange={(e) => {
            const env = e.target.value as Environment;
            setForm((prev) => ({ ...prev, environment: env, readOnly: readOnlyDefault(env) }));
          }}>
          {ENVIRONMENTS.map((env) => (<option key={env.value} value={env.value}>{env.label}</option>))}
        </Select>
      </Field>

      <Field label="">
        <label style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, marginTop: t.GAP_XS, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, cursor: 'pointer' }} htmlFor="readOnly">
          <input id="readOnly" type="checkbox" checked={form.readOnly} onChange={(e) => set('readOnly', e.target.checked)} style={checkboxStyle} />
          Open read-only
          <span style={{ textTransform: 'none', letterSpacing: 0, color: t.TEXT_FAINT }}>— the server refuses writes; on by default for Production</span>
        </label>
      </Field>

      <Field label="Engine" htmlFor="type">
        <Select id="type" value={form.type} onChange={(e) => set('type', e.target.value as EngineType)}>
          {ENGINES.map((e) => (<option key={e.value} value={e.value}>{e.label}</option>))}
        </Select>
      </Field>

      <Field label="Authentication" htmlFor="authMethod">
        <Select id="authMethod" value={form.authMethod} onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}>
          <option value="password">Password</option>
          <option value="iam">AWS IAM (RDS)</option>
        </Select>
      </Field>

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

      <Field label="">
        <label style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, marginTop: t.GAP_XS, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, cursor: 'pointer' }} htmlFor="ssl">
          <input id="ssl" type="checkbox" checked={iam ? true : form.ssl} disabled={iam} onChange={(e) => set('ssl', e.target.checked)} style={checkboxStyle} />
          Connect over SSL
          <span style={{ textTransform: 'none', letterSpacing: 0, color: t.TEXT_FAINT }}>
            {iam ? '— required for IAM authentication' : "— the server's certificate must be one this machine trusts"}
          </span>
        </label>
      </Field>

      <Field label="User" htmlFor="user">
        <Input id="user" value={form.user} placeholder={engine.defaultUser} onChange={(e) => set('user', e.target.value)} />
      </Field>

      {!iam && (
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" value={form.password} disabled={!passwordUsed}
            placeholder={mode === 'edit' && initial?.hasPassword ? 'unchanged' : ''}
            onChange={(e) => { set('password', e.target.value); set('passwordTouched', true); }} />
          {willBeStored && (
            <label style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, marginTop: t.GAP_XS, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, cursor: 'pointer' }} htmlFor="savePassword">
              <input id="savePassword" type="checkbox" checked={form.savePassword} onChange={(e) => set('savePassword', e.target.checked)} style={checkboxStyle} />
              Save the password
              <span style={{ textTransform: 'none', letterSpacing: 0, color: t.TEXT_FAINT }}>— otherwise you are asked for it each time</span>
            </label>
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

      <Field label="Database" htmlFor="database" hint={form.type === 'postgres' ? '(default: postgres)' : '(optional)'}>
        <Input id="database" value={form.database} onChange={(e) => set('database', e.target.value)} />
      </Field>

      <div data-testid="connect-actions" style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button type="submit" data-testid="connect-submit" variant="primary" style={{ justifyContent: 'center', height: 34, flex: 1 }} disabled={busy || !form.name.trim()}>
          {mode === 'edit' ? (busy ? 'Saving…' : 'Save changes') : busy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </form>
  );
}
