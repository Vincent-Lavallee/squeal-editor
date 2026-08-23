import type { ReactNode } from 'react';

import { useAwsSignIn } from '../../store/awsSignInSlice.ts';
import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';

interface Props {
    profile: string;
    label?: string;
    /** A line under the button, for the case that has room to explain itself. */
    hint?: ReactNode;
    disabled?: boolean;
    onSignedIn?: () => void;
}

/**
 * Refreshing an AWS profile's SSO session, wherever the app finds itself
 * needing one. See `AwsSignInStatus` for why the two are split.
 */
export default function AwsSignInButton({
    profile,
    label = 'Sign in to AWS',
    hint,
    disabled,
    onSignedIn,
}: Props) {
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
