import { useState } from 'react';

import type { EngineType, SavedConnection, ServerConfig } from '../../../../shared/protocol.ts';
import { ENGINES, engineByType } from '../../engines.ts';

/**
 * What the form knows. Turning this into a `PasswordUpdate` is the screen's job,
 * not the form's -- the form reports what the user did and stays out of the
 * store/keep/none decision.
 */
export interface FormValues {
  name: string;
  config: ServerConfig;
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
  // Nothing is stored without a name, so there is no password decision to make.
  const canChooseToSave = mode === 'edit' || named;
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
      },
      password: form.password,
      savePassword: canChooseToSave && form.savePassword,
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
        {canChooseToSave && (
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
