import { useState } from 'react';

import type { EngineType, Environment, SavedConnection, ServerConfig } from '../../../../shared/protocol.ts';
import { ENGINES, engineByType } from '../../engines.ts';
import { DEFAULT_ENVIRONMENT, ENVIRONMENTS } from '../../environments.ts';

/**
 * What the form knows. Turning this into a `PasswordUpdate` is the screen's job,
 * not the form's -- the form reports what the user did and stays out of the
 * store/keep/none decision.
 *
 * The workspace is not here: the form is shown *from inside* one, so which it is
 * is the screen's fact rather than a field. Offering a picker would be a second
 * place to choose the thing you already chose to get here.
 */
export interface FormValues {
  name: string;
  config: ServerConfig;
  environment: Environment;
  password: string;
  savePassword: boolean;
  /** Editing only: an untouched field means the stored password stands. */
  passwordTouched: boolean;
}

interface Props {
  mode: 'new' | 'edit';
  /** The connection being edited; absent when adding. */
  initial?: SavedConnection;
  onSubmit: (values: FormValues) => void;
  /** Absent when there is nothing to go back to (the first-run empty list). */
  onCancel?: () => void;
  busy: boolean;
}

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
  savePassword: boolean;
  passwordTouched: boolean;
}

function initialState(initial?: SavedConnection): FormState {
  if (!initial) {
    return {
      name: '',
      type: 'postgres',
      host: 'localhost',
      port: '',
      user: '',
      password: '',
      database: '',
      environment: DEFAULT_ENVIRONMENT,
      ssl: false,
      savePassword: true,
      passwordTouched: false,
    };
  }

  return {
    name: initial.name,
    type: initial.config.type,
    host: initial.config.host,
    port: String(initial.config.port),
    user: initial.config.user,
    database: initial.config.database ?? '',
    environment: initial.environment,
    ssl: initial.config.ssl ?? false,
    // Never prefilled -- the extension does not send it back, which is the whole
    // point. `savePassword` carries whether one is stored; leaving the field
    // alone keeps it.
    password: '',
    savePassword: initial.hasPassword,
    passwordTouched: false,
  };
}

export default function ConnectionForm({ mode, initial, onSubmit, onCancel, busy }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(initial));
  const engine = engineByType(form.type);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const named = form.name.trim() !== '';
  // Nothing is stored without a name, so neither the password decision nor the
  // environment has anything to be true of: an unnamed connection is used once
  // and forgotten, and it never appears under a heading.
  const willBeStored = mode === 'edit' || named;
  // When editing, the password is only ever stored, never used to connect.
  const passwordUsed = mode === 'new' || form.savePassword;

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSubmit({
      name: form.name.trim(),
      config: {
        type: form.type,
        host: form.host,
        // Blank port/user fall back to the engine's convention rather than erroring.
        port: Number(form.port) || engine.defaultPort,
        user: form.user || engine.defaultUser,
        database: form.database || undefined,
        ssl: form.ssl,
      },
      environment: form.environment,
      password: form.password,
      savePassword: willBeStored && form.savePassword,
      passwordTouched: form.passwordTouched,
    });
  }

  return (
    <form className="connect__form" onSubmit={handleSubmit}>
      <div className="field">
        <label className="label" htmlFor="name">
          Name{' '}
          <span className="field__hint">
            {mode === 'edit' ? '(required)' : "(optional — blank won't be saved)"}
          </span>
        </label>
        <input
          id="name"
          className="input"
          value={form.name}
          autoFocus
          placeholder={mode === 'edit' ? '' : 'prod-analytics'}
          required={mode === 'edit'}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      {/*
       * Asked for whether or not this will be kept, which the password checkbox
       * below is still gated on and this no longer is.
       *
       * It used to be: an environment was a heading in the workspace's list, and
       * a nameless connection is never in that list, so there was nothing for it
       * to be true of. An environment is also the rail's colour now, and every
       * open connection is on the rail -- so a nameless one has somewhere to say
       * this, and "the connection I opened once to check something" is exactly
       * the one worth colouring red.
       */}
      <div className="field">
        <label className="label" htmlFor="environment">
          Environment
        </label>
        <select
          id="environment"
          className="select"
          value={form.environment}
          onChange={(e) => set('environment', e.target.value as Environment)}
        >
          {ENVIRONMENTS.map((env) => (
            <option key={env.value} value={env.value}>
              {env.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="type">
          Engine
        </label>
        <select
          id="type"
          className="select"
          value={form.type}
          onChange={(e) => set('type', e.target.value as EngineType)}
        >
          {ENGINES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div className="connect__row">
        <div className="field">
          <label className="label" htmlFor="host">
            Host
          </label>
          <input id="host" className="input" value={form.host} onChange={(e) => set('host', e.target.value)} />
        </div>
        <div className="field connect__port">
          <label className="label" htmlFor="port">
            Port
          </label>
          <input
            id="port"
            className="input"
            value={form.port}
            placeholder={String(engine.defaultPort)}
            onChange={(e) => set('port', e.target.value)}
          />
        </div>
      </div>

      {/*
       * With host and port, because it is part of how the server is reached
       * rather than who is reaching it -- and the hint says "verified" out loud,
       * since that is the difference between this and the SSL checkbox in every
       * other tool, and it is the reason ticking it can fail against a server
       * that a laxer client would have connected to.
       */}
      <div className="field">
        <label className="check" htmlFor="ssl">
          <input
            id="ssl"
            type="checkbox"
            checked={form.ssl}
            onChange={(e) => set('ssl', e.target.checked)}
          />
          Connect over SSL
          <span className="field__hint">— the server's certificate must be one this machine trusts</span>
        </label>
      </div>

      <div className="field">
        <label className="label" htmlFor="user">
          User
        </label>
        <input
          id="user"
          className="input"
          value={form.user}
          placeholder={engine.defaultUser}
          onChange={(e) => set('user', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="input"
          type="password"
          value={form.password}
          disabled={!passwordUsed}
          placeholder={mode === 'edit' && initial?.hasPassword ? 'unchanged' : ''}
          onChange={(e) => {
            set('password', e.target.value);
            set('passwordTouched', true);
          }}
        />
        {willBeStored && (
          <label className="check" htmlFor="savePassword">
            <input
              id="savePassword"
              type="checkbox"
              checked={form.savePassword}
              onChange={(e) => set('savePassword', e.target.checked)}
            />
            Save the password
            <span className="field__hint">— otherwise you are asked for it each time</span>
          </label>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="database">
          Database{' '}
          <span className="field__hint">{form.type === 'postgres' ? '(default: postgres)' : '(optional)'}</span>
        </label>
        <input
          id="database"
          className="input"
          value={form.database}
          onChange={(e) => set('database', e.target.value)}
        />
      </div>

      <div className="connect__actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn--primary connect__submit" disabled={busy}>
          {mode === 'edit' ? (busy ? 'Saving…' : 'Save changes') : busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </form>
  );
}
