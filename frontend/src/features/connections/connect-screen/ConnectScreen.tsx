import Button from '../../../common/components/Button.tsx';
import * as t from '../../../common/tokens';
import ConnectScreenBody from './ConnectScreenBody.tsx';
import ConnectScreenStatus from './ConnectScreenStatus.tsx';
import { screenSubtitle } from './connectScreenLogic.ts';
import { useConnectScreen } from '../hooks/useConnectScreen.ts';

interface Props {
    onCancel?: () => void;
}

export default function ConnectScreen({ onCancel }: Props) {
    const c = useConnectScreen();

    return (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: t.GAP_XL }}>
            <div
                style={{
                    background: t.BG,
                    border: `1px solid ${t.BORDER_STRONG}`,
                    borderRadius: t.RADIUS_LG,
                    padding: t.GAP_XL,
                    width: 420,
                }}
            >
                {/* The title says what the app is; the line under it says where you are
            in it, which changes as you move between the picker, a list and a
            form. A fixed tagline said neither and was read once, on the first
            launch, and never again. */}
                <h1
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: t.GAP_SM,
                        margin: 0,
                        fontSize: t.TEXT_PAGE,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                    }}
                >
                    Squeal
                </h1>
                <p style={{ margin: `4px 0 ${t.GAP_XL}px`, color: t.TEXT_MUTED }}>
                    {c.loading ? 'Reading your saved connections…' : screenSubtitle(c.resolved)}
                </p>

                {onCancel && (
                    <Button
                        data-testid="connect-back"
                        variant="ghost"
                        style={{
                            justifyContent: 'flex-start',
                            width: '100%',
                            marginBottom: t.GAP_LG,
                        }}
                        onClick={onCancel}
                    >
                        ← Back to {c.session.name || c.session.serverLabel}
                    </Button>
                )}

                <ConnectScreenBody c={c} />
                <ConnectScreenStatus c={c} />
            </div>
        </div>
    );
}
