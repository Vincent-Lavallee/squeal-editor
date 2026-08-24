import AwsSignInButton from '../aws-sign-in/AwsSignInButton.tsx';
import Callout from '../../../common/components/Callout.tsx';
import * as t from '../../../common/tokens';

interface Props {
    error: string;
    failedIamProfile: string | null;
    connectingId: string | null;
    busy: boolean;
    onDismissAndRetry: (connectingId: string) => void;
}

/**
 * A cancelled attempt is not a failure -- the user asked for this one to
 * stop, so it reads in the same muted voice as "Connecting for…" rather than
 * in the red a real connect error gets.
 */
export default function ConnectScreenErrorBanner({
    error,
    failedIamProfile,
    connectingId,
    busy,
    onDismissAndRetry,
}: Props) {
    if (error === 'Cancelled.') {
        return (
            <div
                data-testid="connect-cancelled"
                style={{
                    marginTop: t.GAP_LG,
                    textAlign: 'center',
                    fontSize: t.TEXT_BADGE,
                    color: t.TEXT_MUTED,
                }}
            >
                {error}
            </div>
        );
    }

    return (
        <div
            style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_SM, marginTop: t.GAP_LG }}
        >
            <Callout>{error}</Callout>
            {/* The fix rendered beside the failure it fixes, rather than in a message
          telling the user where to go and find it. The retry is the same
          connect that just failed: signing in is only ever wanted here
          because something was trying to get in. */}
            {failedIamProfile && connectingId && (
                <AwsSignInButton
                    profile={failedIamProfile}
                    disabled={busy}
                    onSignedIn={() => onDismissAndRetry(connectingId)}
                />
            )}
        </div>
    );
}
