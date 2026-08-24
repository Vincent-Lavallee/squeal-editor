import Callout from '../../../common/components/Callout.tsx';

interface Props {
    engineLabel: string;
    serverVersion: string | null;
    testError: string | null;
}

/**
 * Beside the button that ran it, not in the screen's error slot: the
 * fix-and-retry loop happens here, and the engine's name is the form's own --
 * the extension answers with the version and nothing else.
 */
export default function ConnectionTestResult({ engineLabel, serverVersion, testError }: Props) {
    return (
        <>
            {serverVersion !== null && (
                <div data-testid="connect-test-result">
                    <Callout tone="success">
                        Connected to {engineLabel} {serverVersion}
                    </Callout>
                </div>
            )}
            {testError && (
                <div data-testid="connect-test-error">
                    <Callout>{testError}</Callout>
                </div>
            )}
        </>
    );
}
