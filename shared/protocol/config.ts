/**
 * What it takes to reach a server, and how the app files what it reached.
 *
 * Everything here describes a connection rather than an answer from one: the
 * engine, the address, the secret policy, and the workspace/environment a saved
 * connection is filed under.
 */

export type EngineType = 'mysql' | 'postgres';

/**
 * How an engine's SQL is written, as the engine itself reports it.
 *
 * The UI highlights a query without knowing which engine it is talking to: it
 * takes this value and hands it to the editor. That is the whole point -- a
 * `type === 'mysql'` in the renderer is the thing this exists to prevent, the
 * same way preview SQL is quoted in the driver rather than guessed at up there.
 *
 * The values are Monaco's language ids, so nothing has to translate them. That
 * is a deliberate coupling to the one editor this app has, and it is cheaper
 * than a lookup table on each side of the bridge that could disagree. A dialect
 * Monaco does not know would be spelled `sql` here, not invented.
 */
export type SqlDialect = 'mysql' | 'pgsql' | 'sql';

/**
 * Reach the server with an RDS IAM auth token rather than a stored password.
 *
 * Its presence on a `ServerConfig` *is* the auth method -- there is no separate
 * `auth: 'password' | 'iam'` flag, because a second field saying what these two
 * already say is two sources for one fact. The extension mints a short-lived
 * token from the SSO-backed profile at connect time and uses it as the password;
 * the token is never stored and never crosses the bridge, only the `profile` and
 * `region` that mint it do.
 *
 * IAM auth is refused without `ssl`: an unencrypted IAM token is a bearer secret
 * sent in the clear, so the extension will not open the connection and the UI
 * forces `ssl` on when this is chosen. Unlike a password connection, the TLS is
 * verified against a committed Amazon RDS CA bundle rather than the machine's
 * trust store, because RDS certificates chain to Amazon's own authorities that a
 * default trust store does not carry -- see `docs/decisions.md`.
 */
export interface AwsIamAuth {
  /** The named AWS profile (from `~/.aws/config`) whose credentials sign the token. */
  profile: string;
  /** The region the RDS instance is in; the token is scoped to it. */
  region: string;
}

/**
 * Everything needed to reach a server *except* the secret.
 *
 * The split is what lets the password stay out of places that have no business
 * holding it: a saved connection describes a `ServerConfig` and keeps its
 * password encrypted in the extension, and the UI's session holds a
 * `ServerConfig` too -- once connected, nothing in the webview reads the
 * password again, so it is not kept.
 */
export interface ServerConfig {
  type: EngineType;
  host: string;
  port: number;
  user: string;
  /** Bootstrap database. Postgres must connect to one; MySQL may omit it. */
  database?: string;
  /**
   * Reach the server over TLS, verifying its certificate against the machine's
   * trust store. Absent means plaintext.
   *
   * It is one flag rather than an engine's own ladder of modes -- and the flag
   * means *verified* TLS, not merely encrypted, which is the only reading that
   * survives being written down. Both engines' libraries would happily take
   * `rejectUnauthorized: false` and hand back a channel that is encrypted
   * against an observer and wide open to anyone in the middle of it; a
   * connection like that would report "SSL" while guaranteeing nothing, which is
   * the same lie as a `Date` that shifts an hour. So verification is not a
   * second option here -- there is nothing to turn off.
   *
   * The cost is that a server whose certificate the machine does not already
   * trust -- RDS, or any private CA -- cannot be reached with this on until a CA
   * certificate can be named. That is a backlog item, and until it lands the
   * failure is a refused connect that says so, not a silent downgrade.
   */
  ssl?: boolean;
  /**
   * Present when the connection authenticates with an RDS IAM token instead of a
   * password. It requires `ssl` and carries no secret of its own -- the token is
   * minted at connect time from the profile and region here. Absent means the
   * ordinary password auth every other connection uses.
   */
  iam?: AwsIamAuth;
}

/**
 * A server plus the password to reach it. Only ever travels UI -> extension.
 *
 * For an IAM connection (`config.iam` set) there is no password to carry -- the
 * extension mints the token itself -- so `password` is an empty string the
 * drivers never read. The field stays required rather than optional so the
 * password path keeps its compile-time guarantee that a secret is present.
 */
export interface ConnectionConfig extends ServerConfig {
  password: string;
}

/**
 * Which deployment of a project a connection reaches.
 *
 * A fixed set for now, deliberately: the point is grouping a workspace's
 * connections under headings that mean the same thing in every workspace, and
 * a free-text field gives you `prod`, `Prod` and `production` as three groups.
 * Any number of connections may share one -- these are labels, not slots.
 */
export type Environment = 'local' | 'dev' | 'staging' | 'production';

/**
 * A workspace's mark, as an id rather than a glyph.
 *
 * The store keeps the id and the UI resolves it to a drawing, which is the same
 * rule as `SqlDialect` one step over: the extension carries a value it does not
 * read. The set is small and deliberately disjoint from the chrome's own icons,
 * so a workspace can never wear a table's or a view's glyph and be mistaken for
 * one -- see `docs/design-system.md`.
 */
export type WorkspaceIconId =
  | 'stack'
  | 'cube'
  | 'rocket'
  | 'flask'
  | 'building'
  | 'cart'
  | 'chart'
  | 'globe'
  | 'leaf';

/**
 * A workspace's colour, as an id rather than a hex.
 *
 * Same rule as `WorkspaceIconId` above and `SqlDialect` one step over: the
 * extension carries a value it does not read, and the UI resolves the id to a
 * swatch. The hex lives in `tokens.css`, the one place a colour is written; this
 * is only the name of the swatch chosen. A fixed palette, picked beside the icon,
 * with `slate` the neutral default so a workspace made before this -- or edited
 * by hand -- is never colourless.
 */
export type WorkspaceColorId =
  | 'slate'
  | 'blue'
  | 'cyan'
  | 'green'
  | 'amber'
  | 'orange'
  | 'red'
  | 'pink'
  | 'purple';

/**
 * A project's connections, grouped.
 *
 * It groups and carries no behaviour of its own: nothing about connecting reads
 * a workspace, and a connection works exactly the same whichever one it is in.
 * The only rule it enforces is the one that follows from grouping at all -- a
 * connection's name has to be unique within its workspace, not across the app.
 *
 * The `icon` and `colour` are how the rail tells one workspace's group from
 * another once its connections are open; both are ids the UI resolves to a
 * drawing and a swatch.
 */
export interface Workspace {
  id: string;
  name: string;
  icon: WorkspaceIconId;
  color: WorkspaceColorId;
}

/**
 * A connection the user named and kept. The password is deliberately absent:
 * it lives encrypted in the extension's store and never crosses the bridge in
 * this direction, so `hasPassword` is all the UI learns about it.
 */
export interface SavedConnection {
  id: string;
  /** The workspace it belongs to. Deleting that workspace deletes this. */
  workspaceId: string;
  name: string;
  config: ServerConfig;
  environment: Environment;
  /**
   * Open this connection read-only, letting the server refuse writes.
   *
   * Beside `environment` rather than inside `config`, and deliberately: a
   * `ServerConfig` is what it takes to *reach* a server, and read-only is a
   * session policy that changes nothing about reaching it -- the same reason
   * `environment` is a sibling and not a field of the config. Defaulted on for
   * Production, but that policy lives in the UI; the extension is told a boolean.
   */
  readOnly: boolean;
  /** False when the user chose not to store one -- connecting must ask for it. */
  hasPassword: boolean;
}

/**
 * What to do with the password when saving. Three cases, all of them real, and
 * `keep` is why this is a union rather than a `string | null`: the edit form is
 * never sent the password it is editing, so "leave it alone" cannot be spelled
 * as a value.
 */
export type PasswordUpdate =
  | { mode: 'store'; password: string }
  | { mode: 'none' }
  | { mode: 'keep' };
