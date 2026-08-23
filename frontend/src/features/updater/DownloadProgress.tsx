import * as t from '../../common/tokens';

export default function DownloadProgress({
    version,
    percent,
}: {
    version: string | null;
    percent: number | null;
}) {
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
    );
}
