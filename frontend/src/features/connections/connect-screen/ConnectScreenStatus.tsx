import AwsSignInStatus from '../aws-sign-in/AwsSignInStatus.tsx';
import * as t from '../../../common/tokens';
import ConnectScreenConnectingBanner from './ConnectScreenConnectingBanner.tsx';
import ConnectScreenErrorBanner from './ConnectScreenErrorBanner.tsx';
import type { useConnectScreen } from '../hooks/useConnectScreen.ts';

/**
 * Everything under the active screen: the running sign-in (list only -- the
 * form draws its own copy in its Authentication section), the in-flight
 * connect's clock and abort, and the last error, with a sign-in offered
 * beside it when that is what would fix it.
 */
export default function ConnectScreenStatus({ c }: { c: ReturnType<typeof useConnectScreen> }) {
    return (
        <>
            {c.resolved.view === 'list' && <AwsSignInStatus style={{ marginTop: t.GAP }} />}

            {c.session.connecting && c.resolved.view !== 'new' && (
                <ConnectScreenConnectingBanner
                    connectingElapsed={c.connectingElapsed}
                    onAbort={c.abortConnect}
                />
            )}

            {c.error && (
                <ConnectScreenErrorBanner
                    error={c.error}
                    failedIamProfile={c.failedIamProfile}
                    connectingId={c.connectingId}
                    busy={c.busy}
                    onDismissAndRetry={(connectingId) => {
                        c.session.dismissError();
                        void c.session.connectSaved(connectingId);
                    }}
                />
            )}
        </>
    );
}
