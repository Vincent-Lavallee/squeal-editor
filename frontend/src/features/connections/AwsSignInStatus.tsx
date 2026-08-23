import type { CSSProperties } from 'react';

import { useAwsSignIn } from '../../store/awsSignInSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Mono from '../../common/components/Mono.tsx';
import * as t from '../../common/tokens';

/**
 * What the running sign-in is waiting on, and how the last one ended.
 *
 * Rendered once per screen, never per row: there is one CLI running at a time,
 * so a copy beside every blocked connection would be the same URL and the same
 * code repeated down the list. See `AwsSignInButton` for why the two are split.
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
