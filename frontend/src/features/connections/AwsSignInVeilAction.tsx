import { useAwsSignIn } from '../../store/awsSignInSlice.ts';
import * as t from '../../common/tokens';
import { chipStyle, frostStyle, paneStyle } from './awsSignInVeilStyles.ts';

interface Props {
    profile: string;
    reason: string | null;
    shown: boolean;
    onSignedIn?: () => void;
}

/**
 * The sign-in as a pane laid over the thing it is blocking.
 *
 * The whole pane is the target, not a button centred in it: the pane is already
 * the width of the row it covers, and a button floating inside it makes the
 * other nine tenths of an obviously-interactive surface do nothing.
 *
 * **It reveals on hover**, the same rule the row's own Edit and Delete follow,
 * and with the same trap: `pointerEvents` has to track the reveal, or an
 * invisible pane sits over the row swallowing every click. What says the row is
 * unavailable at rest is the row itself being dimmed -- see `SavedConnectionList`.
 */
export default function AwsSignInVeilAction({ profile, reason, shown, onSignedIn }: Props) {
    const { signingIn, start } = useAwsSignIn();

    return (
        <button
            type="button"
            data-testid="saved-blocked"
            title={reason ?? undefined}
            disabled={signingIn}
            style={{ ...paneStyle(shown), cursor: signingIn ? 'default' : 'pointer' }}
            onClick={() =>
                void (async () => {
                    if (await start(profile)) onSignedIn?.();
                })()
            }
        >
            <span aria-hidden="true" style={frostStyle(shown)} />
            {/* The primary button, to the letter -- solid accent, dark text on it, its
          own hue as the border -- because that is what this is: the one action
          the row is waiting on. The pane around it has no box of its own to say
          so, and a translucent label on glass was saying it too quietly.

          `lineHeight` rather than a flex centre: the label has to be able to
          ellipsise, and text in a flex box cannot.

          No hover state, unlike a real `<Button>`. The pane is only up while it
          is already hovered or focused, so a hover fill would be the only fill
          anyone ever saw. Dimmed while the CLI is out, which is the disabled
          primary's own answer. */}
            <span
                data-testid="aws-signin"
                style={{
                    ...chipStyle(shown),
                    display: 'inline-block',
                    height: t.BUTTON_H,
                    padding: '0 12px',
                    border: `1px solid ${t.ACCENT}`,
                    borderRadius: t.RADIUS,
                    background: t.ACCENT,
                    color: t.ON_ACCENT,
                    fontWeight: 600,
                    lineHeight: `${t.BUTTON_H - 2}px`,
                    opacity: shown ? (signingIn ? 0.45 : 1) : 0,
                }}
            >
                {signingIn ? 'Waiting for approval…' : 'Sign in to AWS'}
            </span>
        </button>
    );
}
