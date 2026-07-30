import { useEffect, useRef, useState } from 'react';

import type { ConnectionColorId, EngineType, Environment, EnvironmentDef, SavedConnection, ServerConfig, TestPassword } from '../../../../shared/protocol/index.ts';
import { ENGINES, engineByType, isFileBased } from '../../common/db/engines.ts';
import { CONNECTION_COLORS, DEFAULT_CONNECTION_COLOR, connectionColor } from '../../common/icons/connectionColors.ts';
import { CloseIcon } from '../../common/icons/icons.ts';
import { useAwsSignIn } from '../../store/awsSignInSlice.ts';
import { useConnectionTest } from '../../store/connectionTestSlice.ts';
import AwsSignInStatus, { AwsSignInButton } from './AwsSignIn.tsx';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Checkbox from '../../common/components/Checkbox.tsx';
import Input from '../../common/components/Input.tsx';
import Mono from '../../common/components/Mono.tsx';
import Select from '../../common/components/Select.tsx';
import Field, { Label } from '../../common/components/Field.tsx';
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
  /**
   * Set only while a connect this form started is still in flight, and it is
   * what puts the actions row into its abort state. Absent means there is
   * nothing to stop -- including on the edit form, which saves rather than
   * connects and so never passes one.
   */
  onAbortConnect?: () => void;
  /** Seconds since that attempt began, ticked by the screen that owns the clock. */
  connectingElapsed?: number;
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

/**
 * The fields that must hold something before this form describes a connection.
 * Which of them apply depends on the engine and the authentication method, so
 * the set is computed rather than declared -- see `missingFields`.
 */
type RequiredField = 'name' | 'host' | 'database' | 'awsProfile' | 'awsRegion';

// Matches the shipped default environment's own name, which is the only name
// this can know without a policy of what a team calls its production tier. A
// renamed or custom "prod-like" environment simply does not get the default --
// the cost of naming freedom, not a bug.
const readOnlyDefault = (environment: Environment): boolean => environment === 'production';

const hiddenRadio: React.CSSProperties = { position: 'absolute', opacity: 0, pointerEvents: 'none' };
// `padding: 0` is load-bearing on the `<button>` form of this: a UA-default
// padding shrinks the content box the tile centres its glyph in, so the mark
// lands off-centre in a box that still measures 32px.
const swatchTile: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 32, height: 32, padding: 0, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, background: t.BG, cursor: 'pointer' };
const swatchDot: React.CSSProperties = { width: 14, height: 14, borderRadius: t.RADIUS_PILL };
// Icons carry their size inline, from the one token. The set draws at 24px by
// default, which is what overflowed this tile.
const iconGlyph: React.CSSProperties = { flex: 'none', width: t.ICON, height: t.ICON };

/** Optional is the exception here, so only the exceptions are labelled. */
const OPTIONAL = <span>(optional)</span>;
/** What a field says once a submit has found it empty. */
const REQUIRED = <span style={{ color: t.RED_TEXT }}>required</span>;

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

/**
 * The server the form currently describes.
 *
 * Both what *Connect* submits and what *Test* reaches are this one function, so
 * a draft can never be tested as one thing and saved as another -- which is the
 * only way a test's answer means anything about the row that follows it.
 */
function serverConfig(form: FormState, iam: boolean): ServerConfig {
  // No server to address and no secret to carry: the empty host, zero port and
  // empty user are what `ServerConfig` documents a file engine writes, and the
  // path travels as `database`.
  if (isFileBased(form.type)) return { type: form.type, host: '', port: 0, user: '', database: form.database.trim() };

  const engine = engineByType(form.type);
  return {
    type: form.type, host: form.host, port: Number(form.port) || engine.defaultPort,
    user: form.user || engine.defaultUser, database: form.database || undefined,
    ssl: iam ? true : form.ssl,
    ...(iam ? { iam: { profile: form.awsProfile.trim(), region: form.awsRegion.trim() } } : {}),
  };
}

/**
 * What is still empty, in the order the fields are drawn.
 *
 * The order is the whole reason this returns a list rather than a set: a failed
 * submit focuses the first entry, and focusing the last field the user can see
 * because a `Set` happened to iterate that way reads as the form picking at
 * random.
 */
function missingFields(form: FormState, iam: boolean, fileBased: boolean): RequiredField[] {
  const missing: RequiredField[] = [];
  if (form.name.trim() === '') missing.push('name');
  if (fileBased) {
    if (form.database.trim() === '') missing.push('database');
    return missing;
  }
  if (form.host.trim() === '') missing.push('host');
  if (iam) {
    if (form.awsProfile.trim() === '') missing.push('awsProfile');
    if (form.awsRegion.trim() === '') missing.push('awsRegion');
  }
  return missing;
}

export default function ConnectionForm({ mode, initial, environments, onSubmit, onCancel, busy, onAbortConnect, connectingElapsed }: Props) {
  const actions = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<FormState>(() => initialState(initial, environments[0]?.name ?? ''));
  const [picking, setPicking] = useState(false);
  // Nothing is marked wrong until a submit has actually looked. A form that
  // reddens a field you have not reached yet is scolding you for not having
  // typed fast enough.
  const [submitted, setSubmitted] = useState(false);
  const engine = engineByType(form.type);
  const { testing, serverVersion, error: testError, test, clear } = useConnectionTest();
  const signIn = useAwsSignIn();

  // A result describes the values as they were when it ran, so any edit
  // withdraws it -- leaving "Connected to PostgreSQL 16.2" under a host that has
  // since been retyped would be the app vouching for something it never reached.
  // Keyed on the whole form rather than on a handler, so a field added later
  // cannot forget to do it; testing changes no field, so the answer survives the
  // render that lands it.
  useEffect(() => { clear(); }, [form, clear]);

  // The sign-in answer is about the profile and nothing else, so it survives
  // every edit that is not one -- unlike a test, which describes the whole form.
  useEffect(() => { signIn.clear(); }, [form.awsProfile, signIn.clear]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Bring the actions row into view when an attempt starts, because that row is
   * now the only way to stop it. Pressing *Connect* leaves it under the cursor
   * already -- `block: 'nearest'` is a no-op then -- but submitting with Enter
   * from a field near the top of a form this tall does not, and the abort would
   * be below the fold at the exact moment it is the one control that matters.
   */
  const connectInFlight = onAbortConnect !== undefined;
  useEffect(() => {
    if (connectInFlight) actions.current?.scrollIntoView({ block: 'nearest' });
  }, [connectInFlight]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const fileBased = isFileBased(form.type);
  // A file has no auth of any kind, so IAM cannot be in play even if the select
  // was left on it before the engine changed.
  const iam = !fileBased && form.authMethod === 'iam';
  const passwordUsed = mode === 'new' || form.savePassword;

  const missing = missingFields(form, iam, fileBased);
  const invalid = (field: RequiredField): boolean => submitted && missing.includes(field);
  const requiredHint = (field: RequiredField): React.ReactNode => (invalid(field) ? REQUIRED : undefined);
  const invalidBox = (field: RequiredField): React.CSSProperties | undefined =>
    invalid(field) ? { borderColor: t.RED } : undefined;

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

  /**
   * Submitting is always allowed, and an incomplete form answers by saying which
   * fields are empty rather than by having refused the click in the first place.
   * A disabled button states that something is wrong and nothing about what.
   */
  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (missing.length > 0) {
      setSubmitted(true);
      document.getElementById(missing[0]!)?.focus();
      return;
    }
    onSubmit({
      name: form.name.trim(),
      config: serverConfig(form, iam),
      environment: form.environment, readOnly: form.readOnly,
      password: iam || fileBased ? '' : form.password,
      savePassword: iam || fileBased ? false : form.savePassword,
      passwordTouched: fileBased ? false : form.passwordTouched,
      color: form.color,
    });
  }

  /**
   * An edit form is never sent the password it is editing, so testing one whose
   * box is still untouched has to reach for the stored secret by name -- the
   * same case `PasswordUpdate.keep` exists for on the way out. Switching the
   * edit to IAM or to a file leaves nothing to decrypt, which is why the mode
   * is read off the form rather than off the row it started as.
   */
  const testPassword: TestPassword =
    mode === 'edit' && !iam && !fileBased && (initial?.hasPassword ?? false) && !form.passwordTouched
      ? { mode: 'stored', savedConnectionId: initial!.id }
      : { mode: 'typed', password: iam || fileBased ? '' : form.password };

  // A test writes no record, so it asks for none of what saving one needs: the
  // name is not part of reaching a server, and refusing to test until one is
  // typed would put the form's own bookkeeping in front of the question.
  const testable = !busy && !testing && (!fileBased || form.database.trim() !== '');

  return (
    // `noValidate`: the browser's own bubble is the very "you may not submit
    // this" the form has stopped saying, and it fires before the handler runs.
    <form noValidate style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }} onSubmit={handleSubmit}>
      {/* First, because it decides which of the fields below even exist -- a
          file engine has no host, no port and no authentication at all. Asked
          last, every answer above it was given without knowing that. */}
      <Field label="Engine" htmlFor="type">
        <Select id="type" value={form.type} onSelect={(value) => setEngine(value as EngineType)}
          options={ENGINES.map((e) => ({ value: e.value, label: e.label }))} />
      </Field>

      <Field label="Name" htmlFor="name" hint={requiredHint('name')}>
        <Input id="name" value={form.name} autoFocus placeholder={mode === 'edit' ? '' : 'prod-analytics'}
          aria-invalid={invalid('name') || undefined} style={invalidBox('name')}
          onChange={(e) => set('name', e.target.value)} />
      </Field>

      {/* The colour is a property of the same thing the environment is -- which
          connection this is, rather than how to reach it -- so the two share a
          row. Expanded, the picker takes the whole row over instead of floating
          a panel above it: the swatches are the same 32px as the select they
          replace, so the row is exactly as tall either way and nothing below
          moves. */}
      {picking ? (
        <Field label="Color">
          <div className="conn-colors" style={{ display: 'flex', gap: t.GAP_XS }} role="radiogroup" aria-label="Color">
            {CONNECTION_COLORS.map(({ id }) => {
              const on = form.color === id;
              return (
                <label key={id} className="conn-colors__pick"
                  style={{ ...swatchTile, ...(on ? { borderColor: t.ACCENT, background: t.SELECTED } : {}) }}>
                  <input type="radio" name="connection-color" value={id} checked={on} style={hiddenRadio}
                    onChange={() => { set('color', id); setPicking(false); }} />
                  <span aria-hidden="true" style={{ ...swatchDot, background: connectionColor(id) }} />
                  <SrOnly>{id}</SrOnly>
                </label>
              );
            })}
            <button type="button" data-testid="color-close" aria-label="Keep the current color"
              style={{ ...swatchTile, marginLeft: 'auto', color: t.TEXT_MUTED }}
              onClick={() => setPicking(false)}>
              <CloseIcon style={iconGlyph} aria-hidden="true" />
            </button>
          </div>
        </Field>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label="Environment" htmlFor="environment">
              <Select id="environment" value={form.environment}
                options={environments.map((env) => ({ value: env.name, label: env.name }))}
                onSelect={(value) => {
                  const env = value as Environment;
                  setForm((prev) => ({ ...prev, environment: env, readOnly: readOnlyDefault(env) }));
                }} />
            </Field>
          </div>
          <Field label="Color">
            <button type="button" data-testid="color-open" style={swatchTile} aria-expanded={false}
              aria-label={`Color: ${form.color}. Choose another`} onClick={() => setPicking(true)}>
              <span aria-hidden="true" style={{ ...swatchDot, background: connectionColor(form.color) }} />
            </button>
          </Field>
        </div>
      )}

      {fileBased ? (
        <Field label="Database file" htmlFor="database" hint={requiredHint('database')}>
          <div style={{ display: 'flex', gap: t.GAP_SM }}>
            <div style={{ flex: 1 }}>
              <Input id="database" value={form.database} placeholder="C:\path\to\app.db"
                aria-invalid={invalid('database') || undefined} style={invalidBox('database')}
                onChange={(e) => set('database', e.target.value)} />
            </div>
            {/* Typing or pasting a path stays possible beside the dialog: when you
                already have the path, that is the shorter route to it. */}
            <Button onClick={() => void browseForFile()} disabled={busy}>Browse…</Button>
          </div>
        </Field>
      ) : (
        <>
          <Section label="Server" />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Host" htmlFor="host" hint={requiredHint('host')}>
                <Input id="host" value={form.host} aria-invalid={invalid('host') || undefined}
                  style={invalidBox('host')} onChange={(e) => set('host', e.target.value)} />
              </Field>
            </div>
            <div style={{ width: 108 }}>
              <Field label="Port" hint={OPTIONAL} htmlFor="port">
                <Input id="port" value={form.port} placeholder={String(engine.defaultPort)} onChange={(e) => set('port', e.target.value)} />
              </Field>
            </div>
          </div>

          <Field label="Database" htmlFor="database"
            hint={form.type === 'postgres' ? <span>(default: postgres)</span> : OPTIONAL}>
            <Input id="database" value={form.database} onChange={(e) => set('database', e.target.value)} />
          </Field>

          {/* The method and what it needs are one question, so they are one
              section: choosing IAM swaps the fields under this heading and
              nothing else on the screen moves. */}
          <Section label="Authentication" />

          <Field label="Method" htmlFor="authMethod">
            <Select id="authMethod" value={form.authMethod} onSelect={(value) => setAuthMethod(value as AuthMethod)}
              options={[{ value: 'password', label: 'Password' }, { value: 'iam', label: 'AWS IAM (RDS)' }]} />
          </Field>

          <Field label="Database user" hint={OPTIONAL} htmlFor="user">
            <Input id="user" value={form.user} placeholder={engine.defaultUser} onChange={(e) => set('user', e.target.value)} />
          </Field>

          {iam ? (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Field label="AWS profile" htmlFor="awsProfile" hint={requiredHint('awsProfile')}>
                    <Input id="awsProfile" value={form.awsProfile} placeholder="default"
                      aria-invalid={invalid('awsProfile') || undefined} style={invalidBox('awsProfile')}
                      onChange={(e) => set('awsProfile', e.target.value)} />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Region" htmlFor="awsRegion" hint={requiredHint('awsRegion')}>
                    <Input id="awsRegion" value={form.awsRegion} placeholder="us-east-1"
                      aria-invalid={invalid('awsRegion') || undefined} style={invalidBox('awsRegion')}
                      onChange={(e) => set('awsRegion', e.target.value)} />
                  </Field>
                </div>
              </div>

              {/* An expired SSO session is the common, recoverable failure here,
                  and the only fix used to be a terminal the app never mentions
                  again. This runs the same command in the same profile. There is
                  nothing to retry afterwards -- the connection does not exist
                  yet -- which is the whole difference from the saved list's copy
                  of this. */}
              <AwsSignInButton profile={form.awsProfile.trim()} disabled={busy}
                hint={<>runs <Mono>aws sso login</Mono> and opens your browser</>} />
              <AwsSignInStatus />
            </>
          ) : (
            <Field label="Password" hint={OPTIONAL} htmlFor="password">
              <Input id="password" type="password" value={form.password} disabled={!passwordUsed}
                placeholder={mode === 'edit' && initial?.hasPassword ? 'unchanged' : ''}
                onChange={(e) => { set('password', e.target.value); set('passwordTouched', true); }} />
              <div style={{ marginTop: t.GAP_XS }}>
                <Checkbox id="savePassword" label="Save the password" hint="otherwise you are asked for it each time"
                  checked={form.savePassword} onChange={(e) => set('savePassword', e.target.checked)} />
              </div>
            </Field>
          )}
        </>
      )}

      {/* Both are answers to "how should it open", which is why they share a row
          rather than each taking a line of their own at opposite ends of the
          form. A file engine has no SSL, so read-only stands alone there. */}
      <Section label="Options" />

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Checkbox id="readOnly" label="Open read-only" hint="the server refuses writes; on by default for Production"
            checked={form.readOnly} onChange={(e) => set('readOnly', e.target.checked)} />
        </div>
        {!fileBased && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <Checkbox id="ssl" label="Connect over SSL" checked={iam ? true : form.ssl} disabled={iam}
              hint={iam ? 'required for IAM authentication' : "the server's certificate must be trusted"}
              onChange={(e) => set('ssl', e.target.checked)} />
          </div>
        )}
      </div>

      {/* One height across the row: a shorter Cancel and Test beside a taller
          Connect read as two rows of controls that happen to be on one line.

          While a connect is in flight the row becomes the way to stop it. The
          screen has an abort of its own, under everything, and on a form this
          tall that is reliably below the fold -- so the attempt you just started
          could only be called off by scrolling to find the button. */}
      <div ref={actions} data-testid="connect-actions" style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
        {onAbortConnect ? (
          <>
            <Button data-testid="connect-abort" onClick={onAbortConnect}>Cancel</Button>
            <Button variant="primary" style={{ justifyContent: 'center', flex: 1 }} disabled>
              Connecting{connectingElapsed === undefined ? '…' : ` for ${connectingElapsed.toFixed(1)}s…`}
            </Button>
          </>
        ) : (
          <>
            {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
            {/* Deliberately not a submit: testing must leave the form exactly where
                it is, since fixing a field and trying again is the whole point. */}
            <Button data-testid="connect-test" onClick={() => test(serverConfig(form, iam), testPassword)} disabled={!testable}>
              {testing ? 'Testing…' : 'Test'}
            </Button>
            <Button type="submit" data-testid="connect-submit" variant="primary" style={{ justifyContent: 'center', flex: 1 }} disabled={busy || testing}>
              {mode === 'edit' ? (busy ? 'Saving…' : 'Save changes') : busy ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        )}
      </div>

      {/* Beside the button that ran it, not in the screen's error slot: the
          fix-and-retry loop happens here, and the engine's name is the form's
          own -- the extension answers with the version and nothing else. */}
      {serverVersion !== null && (
        <div data-testid="connect-test-result">
          <Callout tone="success">Connected to {engine.label} {serverVersion}</Callout>
        </div>
      )}
      {testError && (
        <div data-testid="connect-test-error">
          <Callout>{testError}</Callout>
        </div>
      )}
    </form>
  );
}

/**
 * A heading and the rule that runs out from it. Structure comes from 1px
 * borders, so a group of fields is named and ruled off rather than boxed into a
 * surface of its own.
 */
function Section({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
      <Label>{label}</Label>
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: t.BORDER }} />
    </div>
  );
}
