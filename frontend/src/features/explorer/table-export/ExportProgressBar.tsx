import * as t from '../../../common/tokens';

/**
 * A fill bar for the export's progress, indeterminate (a sweeping highlight)
 * until the total row count lands. Reuses the updater's own sweep animation
 * (`residual.css`'s `update-banner__bar--indeterminate`/`update-banner__fill`)
 * rather than a second copy of the same keyframes under a new name.
 */
export default function ExportProgressBar({ percent }: { percent: number | null }) {
    const barStyle: React.CSSProperties = {
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
        width: percent !== null ? `${percent}%` : undefined,
    };

    return (
        <div
            className={percent === null ? 'update-banner__bar--indeterminate' : undefined}
            style={barStyle}
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div className="update-banner__fill" style={fillStyle} />
        </div>
    );
}
