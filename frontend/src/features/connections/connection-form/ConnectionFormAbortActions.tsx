import Button from '../../../common/components/Button.tsx';

interface Props {
    onAbortConnect: () => void;
    connectingElapsed?: number;
}

export default function ConnectionFormAbortActions({ onAbortConnect, connectingElapsed }: Props) {
    return (
        <>
            <Button data-testid="connect-abort" onClick={onAbortConnect}>
                Cancel
            </Button>
            <Button variant="primary" style={{ justifyContent: 'center', flex: 1 }} disabled>
                Connecting
                {connectingElapsed === undefined ? '…' : ` for ${connectingElapsed.toFixed(1)}s…`}
            </Button>
        </>
    );
}
