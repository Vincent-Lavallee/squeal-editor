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

export function AwsSignInButton({
    profile,
    label = 'Sign in to AWS',
    hint,
    disabled,
    onSignedIn,
}: ButtonProps) {
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
            <Button
                data-testid="aws-signin"
                disabled={disabled || signingIn || profile === ''}
                onClick={() => void signInThenContinue()}
            >
                {signingIn ? 'Waiting for approval…' : label}
            </Button>
            {hint && (
                <div style={{ marginTop: t.GAP_XS, color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>
                    {hint}
                </div>
            )}
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
                <div
                    data-testid="aws-signin-prompt"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: t.GAP_SM,
                        padding: t.GAP,
                        border: `1px solid ${t.BORDER_STRONG}`,
                        borderRadius: t.RADIUS,
                    }}
                >
                    <div style={{ color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}>
                        Approve the sign-in in your browser. If no page opened, open this one:
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM }}>
                        <Button
                            data-testid="aws-signin-open"
                            onClick={() => void Neutralino.os.open(prompt.url)}
                        >
                            Open the sign-in page
                        </Button>
                        {prompt.code && (
                            <span style={{ color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}>
                                code <Mono style={{ color: t.TEXT }}>{prompt.code}</Mono>
                            </span>
                        )}
                    </div>
                    <Mono
                        style={{
                            color: t.TEXT_FAINT,
                            fontSize: t.TEXT_BADGE,
                            wordBreak: 'break-all',
                        }}
                    >
                        {prompt.url}
                    </Mono>
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

/*
 * Where the frost is at full strength and where it lets go. It is deepest under
 * the chip at the leading edge and thins away across the row, so the server line
 * and the engine badge stay legible under the thin end of it.
 *
 * The leading feather is short and does a different job from the long ramp out:
 * the pane's own edge falls mid-row, next to the colour strip, and a sheet of
 * frost cut off square there reads as a rectangle pasted over the row rather
 * than as glass lying on it.
 *
 * The black is not a colour and is not a token's business: a mask reads alpha
 * and nothing else, so these stops are the shape of the fade, written down.
 */
const FROST_RAMP =
    'linear-gradient(90deg, transparent 0%, #000 6%, #000 40%, #000000a6 64%, transparent 100%)';
const FROST_EASE = '0.18s ease-out';

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
 * unavailable at rest is the row itself being dimmed — see `SavedConnectionList`.
 *
 * A profile that is merely *missing* gets the same pane saying so and no click,
 * because no login creates one.
 */
export function AwsSignInVeil({
    profile,
    reason,
    actionable,
    shown,
    onSignedIn,
}: {
    profile: string;
    /** Why the row is blocked. The pane's `title`; never its label — see `chip`. */
    reason: string | null;
    actionable: boolean;
    shown: boolean;
    onSignedIn?: () => void;
}) {
    const { signingIn, start } = useAwsSignIn();

    /*
     * The glass itself, and nothing else: it carries the blur, the wash and the
     * hairlines, and no text ever rides on it.
     *
     * `maskImage` is what makes a real blur affordable here. Frost and wash both
     * fade in from the leading edge, so they thicken toward the label and never
     * reach the name they would otherwise make unreadable. A mask rather than a
     * `clipPath` -- a clip takes the uncovered half out of the hit target too, and
     * the whole pane is the click.
     *
     * The fade lives on this element rather than on the pane around it because an
     * *ancestor* mid-opacity isolates the backdrop: the blur would sample an empty
     * group for the length of the transition and snap in at the end.
     */
    const frost: CSSProperties = {
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(180deg, ${t.VEIL_SHEEN}, transparent 60%), linear-gradient(90deg, ${t.VEIL_DEEP} 30%, ${t.VEIL})`,
        backdropFilter: `blur(${t.VEIL_BLUR}px) saturate(1.3)`,
        WebkitBackdropFilter: `blur(${t.VEIL_BLUR}px) saturate(1.3)`,
        maskImage: FROST_RAMP,
        WebkitMaskImage: FROST_RAMP,
        borderTop: `1px solid ${t.VEIL_EDGE}`,
        borderBottom: `1px solid ${t.VEIL_EDGE}`,
        opacity: shown ? 1 : 0,
        transition: `opacity ${FROST_EASE}`,
        pointerEvents: 'none',
    };

    const pane: CSSProperties = {
        position: 'absolute',
        inset: 0,
        display: 'grid',
        // Against the leading edge, where the frost is deepest -- the chip is the
        // one thing on this pane that is read, so it sits at the end the eye starts
        // from rather than the one it has to travel to.
        placeItems: 'center start',
        padding: '0 10px',
        border: 'none',
        background: 'none',
        font: 'inherit',
        fontSize: t.TEXT_BADGE,
        fontWeight: 500,
        // Tracks the reveal or an invisible pane eats the row's clicks.
        pointerEvents: shown ? 'auto' : 'none',
    };

    /*
     * How whatever the pane has to say sits on the glass, and how it arrives:
     * `position` to paint over the frost, which is positioned, and in from the
     * leading edge a beat behind the glass it lands on.
     *
     * A ground of its own is not decoration. The label is the one thing here that
     * is *not* masked -- it has to stay readable whatever the frost under it is
     * doing -- so it needs one wherever it falls on the row's own text.
     *
     * What that ground looks like is the shape grammar and nothing else: the
     * sign-in is a button, so it is `RADIUS` at `BUTTON_H`, which also lines it up
     * with the row's own Edit; the missing-profile line is a state, so it is a
     * pill. Neither is a `<Button>` or a `<Badge>`, because the pane itself is the
     * `<button>` and one cannot contain the other -- the tab strip's constraint,
     * one row down.
     */
    const chip: CSSProperties = {
        position: 'relative',
        overflow: 'hidden',
        // Never past the frost. The chip is opaque wherever it lands, so one wide
        // enough to reach the thin end of the pane sits on row text that is still
        // sharp, which is the collision the mask was chosen to avoid.
        maxWidth: '72%',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        transform: shown ? 'none' : 'translateX(-6px)',
        transition: `opacity ${FROST_EASE}, transform ${FROST_EASE}`,
    };

    if (!actionable) {
        return (
            <div data-testid="saved-blocked" title={reason ?? undefined} style={pane}>
                <span aria-hidden="true" style={frost} />
                {/* Filled but not outlined, and muted: nothing here is clickable, so
            nothing here draws an edge.

            Three words rather than the reason itself, which names the profile
            and so is as long as the profile is: this is what the pane can afford
            to say without covering the connection it is about, and the reason is
            the pane's `title`. */}
                <span
                    style={{
                        ...chip,
                        padding: '4px 10px',
                        borderRadius: t.RADIUS_PILL,
                        background: t.VEIL_DEEP,
                        color: t.TEXT_MUTED,
                        opacity: shown ? 1 : 0,
                    }}
                >
                    Profile not set up
                </span>
            </div>
        );
    }

    return (
        <button
            type="button"
            data-testid="saved-blocked"
            title={reason ?? undefined}
            disabled={signingIn}
            style={{ ...pane, cursor: signingIn ? 'default' : 'pointer' }}
            onClick={() =>
                void (async () => {
                    if (await start(profile)) onSignedIn?.();
                })()
            }
        >
            <span aria-hidden="true" style={frost} />
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
                    ...chip,
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
