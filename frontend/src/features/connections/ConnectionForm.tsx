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
  readOnly: boolean;
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
  /** Password auth, or an RDS IAM token minted from an AWS profile. */
  authMethod: AuthMethod;
  awsProfile: string;
  awsRegion: string;
}

/**
 * Read-only defaults on for Production and off elsewhere -- the one place that
 * policy lives, since the form is the one place that holds the environment for a
 * connection nobody has saved yet. The box is still freely overridable.
 */
const readOnlyDefault = (environment: Environment): boolean => environment === 'production';

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
      readOnly: readOnlyDefault(DEFAULT_ENVIRONMENT),
      savePassword: true,
      passwordTouched: false,
      authMethod: 'password',
      awsProfile: '',
      awsRegion: '',
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
    readOnly: initial.readOnly,
    // Never prefilled -- the extension does not send it back, which is the whole
    // point. `savePassword` carries whether one is stored; leaving the field
    // alone keeps it.
    password: '',
    savePassword: initial.hasPassword,
    passwordTouched: false,
    // The profile and region are not secret and do come back, so an IAM
    // connection edits with them in place.
    authMethod: initial.config.iam ? 'iam' : 'password',
    awsProfile: initial.config.iam?.profile ?? '',
    awsRegion: initial.config.iam?.region ?? '',
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
  const iam = form.authMethod === 'iam';
  // When editing, the password is only ever stored, never used to connect.
  const passwordUsed = mode === 'new' || form.savePassword;

  /** Choosing IAM forces SSL on -- the extension refuses IAM without it. */
  function setAuthMethod(method: AuthMethod): void {
    setForm((prev) => ({ ...prev, authMethod: method, ssl: method === 'iam' ? true : prev.ssl }));
  }

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
        // IAM carries its TLS with it; the extension refuses it plaintext.
        ssl: iam ? true : form.ssl,
        ...(iam ? { iam: { profile: form.awsProfile.trim(), region: form.awsRegion.trim() } } : {}),
      },
      environment: form.environment,
      readOnly: form.readOnly,
      // An IAM connection has no password and nothing to store for one, so the
      // screen's `passwordUpdate` resolves to "none" off `savePassword: false`.
      password: iam ? '' : form.password,
      savePassword: iam ? false : willBeStored && form.savePassword,
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
          onChange={(e) => {
            const environment = e.target.value as Environment;
            // The Production default follows the picker: choosing Production ticks
            // read-only, choosing anything else unticks it. An intentional change
            // the user makes after is theirs -- until they move the environment
            // again, which is the one gesture that means "reconsider the default".
            setForm((prev) => ({ ...prev, environment, readOnly: readOnlyDefault(environment) }));
          }}
        >
          {ENVIRONMENTS.map((env) => (
            <option key={env.value} value={env.value}>
              {env.label}
            </option>
          ))}
        </select>
      </div>

      {/*
       * Beside the environment because it is defaulted from it, and because
       * read-only is the same kind of fact -- which deployment you are about to
       * point at, and how much you trust yourself not to write to it. The server
       * enforces it; the hint says so, since "read-only" in other tools often
       * means the client politely declining rather than the server refusing.
       */}
      <div className="field">
        <label className="check" htmlFor="readOnly">
          <input
            id="readOnly"
            type="checkbox"
            checked={form.readOnly}
            onChange={(e) => set('readOnly', e.target.checked)}
          />
          Open read-only
          <span className="field__hint">— the server refuses writes; on by default for Production</span>
        </label>
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

      {/*
       * Authentication method. Password is the ordinary case; IAM mints a
       * short-lived RDS token from a local AWS profile at connect time, so the
       * password fields give way to a profile and region and nothing secret is
       * ever stored. It forces SSL, because the token is a bearer secret the
       * extension refuses to send in the clear.
       */}
      <div className="field">
        <label className="label" htmlFor="authMethod">
          Authentication
        </label>
        <select
          id="authMethod"
          className="select"
          value={form.authMethod}
          onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}
        >
          <option value="password">Password</option>
          <option value="iam">AWS IAM (RDS)</option>
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
            checked={iam ? true : form.ssl}
            disabled={iam}
            onChange={(e) => set('ssl', e.target.checked)}
          />
          Connect over SSL
          <span className="field__hint">
            {iam
              ? '— required for IAM authentication'
              : "— the server's certificate must be one this machine trusts"}
          </span>
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

      {!iam && (
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
      )}

      {/*
       * IAM credentials: the AWS profile that mints the token and the region the
       * instance is in. Neither is a secret, so unlike the password both are
       * stored and edit with the connection. No token is ever kept -- it is
       * minted fresh at connect time and expires in minutes.
       */}
      {iam && (
        <div className="connect__row">
          <div className="field">
            <label className="label" htmlFor="awsProfile">
              AWS profile
            </label>
            <input
              id="awsProfile"
              className="input"
              value={form.awsProfile}
              placeholder="default"
              required
              onChange={(e) => set('awsProfile', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="awsRegion">
              Region
            </label>
            <input
              id="awsRegion"
              className="input"
              value={form.awsRegion}
              placeholder="us-east-1"
              required
              onChange={(e) => set('awsRegion', e.target.value)}
            />
          </div>
        </div>
      )}

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
