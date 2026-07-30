import { type CSSProperties, type ReactNode } from 'react';

import { useAwsSignIn } from '../../store/awsSignInSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Mono from '../../common/components/Mono.tsx';
import * as t from '../../common/tokens';

/**
 * Refreshing an AWS profile's SSO session, wherever the app finds itself needing
 * one.
 *
 * Split into the *button* and the *status* because the two do not always sit
 * together. On the connect form they do — you are describing an IAM connection
 * and may as well sign in before trying it, so both go in the Authentication
 * section. On the saved list the button belongs on the row it unblocks, one per
 * connection, while the URL and code the CLI is waiting on describe the one
 * sign-in that is running and belong under the list exactly once.
 *
 * `awsSignIn` is one slice, so this is one component rather than two hand-rolled
 * copies that could render the same state differently.
 *
 * `onSignedIn` is what makes it worth a click: the caller hands it the connect
 * that was blocked, so signing in and getting in is one gesture. The form passes
 * none — there is nothing to connect, the connection does not exist yet.
 */
interface ButtonProps {
  profile: string;
  label?: string;
  /** A line under the button, for the case that has room to explain itself. */
  hint?: ReactNode;
  disabled?: boolean;

  onSignedIn?: () => void;
}

export function AwsSignInButton({ profile, label = 'Sign in to AWS', hint, disabled, onSignedIn }: ButtonProps) {
  const { signingIn, start } = useAwsSignIn();

  /*
   * Sequential in the handler rather than an effect watching `signedIn`: the
   * follow-on must happen once per click, and an effect keyed on a value that
   * stays set would fire again on the next render that touched it -- connecting
   * behind the user's back after a second failure.
   */
  async function signInThenContinue(): Promise<void> {
    if (await start(profile)) onSignedIn?.();
  }

  return (
    <div>
      <Button data-testid="aws-signin" disabled={disabled || signingIn || profile === ''}
        onClick={() => void signInThenContinue()}>
        {signingIn ? 'Waiting for approval…' : label}
      </Button>
      {hint && <div style={{ marginTop: t.GAP_XS, color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>{hint}</div>}
    </div>
  );
}

/**
 * What the running sign-in is waiting on, and how the last one ended.
 *
 * Rendered once per screen, never per row: there is one CLI running at a time,
 * so a copy beside every blocked connection would be the same URL and the same
 * code repeated down the list.
 */
export default function AwsSignInStatus({ style }: { style?: CSSProperties }) {
  const { signedIn, error, prompt } = useAwsSignIn();

  // Nothing to say renders nothing at all, rather than an empty box carrying a
  // margin: the caller spaces this off whatever is above it, and a spacer that
  // is there whether or not there is anything to space is a gap under the list
  // for the entire life of the screen.
  if (!prompt && !signedIn && !error) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_SM, ...style }}>
      {/* The CLI tries to open a browser and cannot always manage it, so the URL
          and code it is waiting on are shown rather than left in a pipe: without
          them a failed browser launch is indistinguishable from a hang. */}
      {prompt && (
        <div data-testid="aws-signin-prompt"
          style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_SM, padding: t.GAP, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS }}>
          <div style={{ color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}>
            Approve the sign-in in your browser. If no page opened, open this one:
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM }}>
            <Button data-testid="aws-signin-open" onClick={() => void Neutralino.os.open(prompt.url)}>
              Open the sign-in page
            </Button>
            {prompt.code && (
              <span style={{ color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}>
                code <Mono style={{ color: t.TEXT }}>{prompt.code}</Mono>
              </span>
            )}
          </div>
          <Mono style={{ color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE, wordBreak: 'break-all' }}>{prompt.url}</Mono>
        </div>
      )}

      {signedIn && (
        <div data-testid="aws-signin-result">
          <Callout tone="success">Signed in to AWS profile {signedIn}.</Callout>
        </div>
      )}
      {error && (
        <div data-testid="aws-signin-error">
          <Callout>{error}</Callout>
        </div>
      )}
    </div>
  );
}

/**
 * The sign-in as a pane laid over the thing it is blocking.
 *
 * The whole pane is the target, not a button centred in it: the pane is already
 * the width of the row it covers, and a button floating inside it makes the
 * other nine tenths of an obviously-interactive surface do nothing.
 *
 * **It reveals on hover**, the same rule the row's own Edit and Delete follow,
 * and with the same trap: `pointerEvents` has to track `opacity`, or an
 * invisible pane sits over the row swallowing every click. What says the row is
 * unavailable at rest is the row itself being dimmed — see `SavedConnectionList`.
 *
 * A profile that is merely *missing* gets the same pane with the reason in it
 * and no click, because no login creates one.
 */
export function AwsSignInVeil({ profile, reason, actionable, shown, onSignedIn }: {
  profile: string;
  reason: string | null;
  actionable: boolean;
  shown: boolean;
  onSignedIn?: () => void;
}) {
  const { signingIn, start } = useAwsSignIn();

  const pane: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    // Against the trailing edge, not centred. The row's name and server sit at
    // the leading edge and are exactly what the pane must not bury -- they are
    // how you know which connection you are being asked to sign in for -- so the
    // label goes where the row has nothing.
    placeItems: 'center end',
    padding: '0 10px',
    // Glass: the app's own colour with a sheen down it and the backdrop lifted
    // rather than softened, deepening toward the label so it reads against a
    // settled ground. Blurring the row was the first cut and it destroyed the
    // one thing the pane needs to keep legible.
    background: `linear-gradient(180deg, ${t.VEIL_SHEEN}, transparent 60%), linear-gradient(90deg, ${t.VEIL}, ${t.VEIL_DEEP} 55%)`,
    backdropFilter: 'saturate(1.4) brightness(1.08)',
    WebkitBackdropFilter: 'saturate(1.4) brightness(1.08)',
    borderTop: `1px solid ${t.VEIL_EDGE}`,
    borderBottom: `1px solid ${t.VEIL_EDGE}`,
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BADGE,
    fontWeight: 500,
    opacity: shown ? 1 : 0,
    // Tracks opacity or an invisible pane eats the row's clicks.
    pointerEvents: shown ? 'auto' : 'none',
  };

  if (!actionable) {
    return (
      <div data-testid="saved-blocked" title={reason ?? undefined} style={{ ...pane, color: t.TEXT_MUTED }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reason}</span>
      </div>
    );
  }

  return (
    <button type="button" data-testid="saved-blocked" title={reason ?? undefined} disabled={signingIn}
      style={{ ...pane, border: 'none', borderTop: `1px solid ${t.VEIL_EDGE}`, borderBottom: `1px solid ${t.VEIL_EDGE}`, cursor: signingIn ? 'default' : 'pointer' }}
      onClick={() => void (async () => { if (await start(profile)) onSignedIn?.(); })()}>
      <span data-testid="aws-signin">{signingIn ? 'Waiting for approval…' : 'Sign in to AWS'}</span>
    </button>
  );
}
