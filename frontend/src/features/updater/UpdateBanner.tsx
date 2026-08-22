import { UpdateIcon } from '../../common/icons/icons.ts';
import { useUpdater } from './useUpdater.ts';
import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16, color: t.ACCENT };

export default function UpdateBanner() {
    const {
        phase,
        status,
        progress,
        dismissed,
        upToDate,
        checkFailed,
        unsupported,
        error,
        check,
        download,
        apply,
        dismiss,
    } = useUpdater();

    // No "Try again": the answer is a property of the platform, not of the attempt.
    if (unsupported) {
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_SM,
                    flex: 'none',
                    padding: `${t.GAP_XS}px ${t.GAP}px`,
                    borderBottom: `1px solid ${t.BORDER}`,
                    color: t.TEXT,
                    fontSize: t.TEXT_BADGE,
                }}
                role="status"
            >
                <UpdateIcon style={iconSvg} />
                <span style={{ marginRight: 'auto' }}>
                    Automatic updates aren&apos;t available on this platform yet.
                </span>
                <Button variant="ghost" onClick={dismiss}>
                    Dismiss
                </Button>
            </div>
        );
    }

    if (checkFailed) {
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_SM,
                    flex: 'none',
                    padding: `${t.GAP_XS}px ${t.GAP}px`,
                    borderBottom: `1px solid ${t.BORDER}`,
                    color: t.TEXT,
                    fontSize: t.TEXT_BADGE,
                }}
                role="status"
            >
                <UpdateIcon style={iconSvg} />
                <span style={{ marginRight: 'auto' }}>Couldn&apos;t check for updates.</span>
                <Button onClick={() => check(true)}>Try again</Button>
                <Button variant="ghost" onClick={dismiss}>
                    Dismiss
                </Button>
            </div>
        );
    }

    if (upToDate) {
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_SM,
                    flex: 'none',
                    padding: `${t.GAP_XS}px ${t.GAP}px`,
                    borderBottom: `1px solid ${t.BORDER}`,
                    color: t.TEXT,
                    fontSize: t.TEXT_BADGE,
                }}
                role="status"
            >
                <UpdateIcon style={iconSvg} />
                <span style={{ marginRight: 'auto' }}>You&apos;re on the latest version.</span>
                <Button variant="ghost" onClick={dismiss}>
                    Dismiss
                </Button>
            </div>
        );
    }

    if (!status?.hasUpdate || dismissed) return null;
    const version = status.latestVersion;

    const percent =
        progress && progress.totalBytes > 0
            ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
            : null;

    const barStyle: React.CSSProperties = {
        flex: 1,
        maxWidth: 240,
        height: 4,
        borderRadius: t.RADIUS_PILL,
        background: t.BORDER,
        overflow: 'hidden',
    };
    const fillStyle: React.CSSProperties = {
        height: '100%',
        borderRadius: 'inherit',
        background: t.ACCENT,
        transition: 'width 0.15s linear',
        ...(percent !== null ? { width: `${percent}%` } : {}),
    };

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_SM,
                flex: 'none',
                padding: `${t.GAP_XS}px ${t.GAP}px`,
                borderBottom: `1px solid ${t.BORDER}`,
                color: t.TEXT,
                fontSize: t.TEXT_BADGE,
            }}
            role="status"
        >
            <UpdateIcon style={iconSvg} />

            {phase === 'downloading' ? (
                <>
                    <span style={{ marginRight: 'auto' }}>Downloading Squeal {version}…</span>
                    <div
                        className={`update-banner__bar${percent === null ? ' update-banner__bar--indeterminate' : ''}`}
                        style={barStyle}
                        role="progressbar"
                        aria-valuenow={percent ?? undefined}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <div className="update-banner__fill" style={fillStyle} />
                    </div>
                    {percent !== null && (
                        <span
                            style={{
                                flex: 'none',
                                color: t.TEXT_MUTED,
                                fontSize: t.TEXT_BADGE,
                                fontFamily: t.MONO,
                            }}
                        >
                            {percent}%
                        </span>
                    )}
                </>
            ) : phase === 'ready' ? (
                <>
                    <span style={{ marginRight: 'auto' }}>
                        Squeal {version} is ready to install.
                    </span>
                    <Button variant="primary" onClick={apply}>
                        Restart to update
                    </Button>
                    <Button variant="ghost" onClick={dismiss}>
                        Later
                    </Button>
                </>
            ) : phase === 'error' ? (
                <>
                    <span style={{ marginRight: 'auto', color: t.RED_TEXT }}>
                        {error ?? 'The update could not be installed.'}
                    </span>
                    <Button onClick={download}>Try again</Button>
                    <Button variant="ghost" onClick={dismiss}>
                        Dismiss
                    </Button>
                </>
            ) : (
                <>
                    <span style={{ marginRight: 'auto' }}>Squeal {version} is available.</span>
                    <Button variant="primary" onClick={download}>
                        Download
                    </Button>
                    <Button variant="ghost" onClick={dismiss}>
                        Later
                    </Button>
                </>
            )}
        </div>
    );
}
