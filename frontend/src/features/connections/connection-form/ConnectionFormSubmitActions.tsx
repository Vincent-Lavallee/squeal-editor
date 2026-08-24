import Button from '../../../common/components/Button.tsx';

interface Props {
    mode: 'new' | 'edit';
    busy: boolean;
    testing: boolean;
    testable: boolean;
    onTest: () => void;
    onCancel?: () => void;
}

export default function ConnectionFormSubmitActions({
    mode,
    busy,
    testing,
    testable,
    onTest,
    onCancel,
}: Props) {
    const submitLabel =
        mode === 'edit' ? (busy ? 'Saving…' : 'Save changes') : busy ? 'Connecting…' : 'Connect';

    return (
        <>
            {onCancel && (
                <Button onClick={onCancel} disabled={busy}>
                    Cancel
                </Button>
            )}
            {/* Deliberately not a submit: testing must leave the form exactly where it
          is, since fixing a field and trying again is the whole point. */}
            <Button data-testid="connect-test" onClick={onTest} disabled={!testable}>
                {testing ? 'Testing…' : 'Test'}
            </Button>
            <Button
                type="submit"
                data-testid="connect-submit"
                variant="primary"
                style={{ justifyContent: 'center', flex: 1 }}
                disabled={busy || testing}
            >
                {submitLabel}
            </Button>
        </>
    );
}
