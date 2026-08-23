import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';

interface Props {
    connectingElapsed: number;
    onAbort: () => void;
}

/** The in-flight connect's clock and abort -- every screen but the form, which owns its own in its actions row. */
export default function ConnectScreenConnectingBanner({ connectingElapsed, onAbort }: Props) {
    return (
        <>
            <div
                style={{
                    marginTop: t.GAP_LG,
                    textAlign: 'center',
                    fontSize: t.TEXT_BADGE,
                    color: t.TEXT_MUTED,
                }}
            >
                Connecting for {connectingElapsed.toFixed(1)}s…
            </div>
            <Button
                data-testid="connecting-cancel"
                variant="ghost"
                style={{ justifyContent: 'center', width: '100%', marginTop: t.GAP_SM }}
                onClick={onAbort}
            >
                Cancel
            </Button>
        </>
    );
}
