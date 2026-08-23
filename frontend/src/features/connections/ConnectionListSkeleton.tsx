import Skeleton from '../../common/components/Skeleton.tsx';
import * as t from '../../common/tokens';

export default function ConnectionListSkeleton() {
    const rowH = 46;
    return (
        <>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_SM,
                    marginBottom: t.GAP_LG,
                    padding: `${t.GAP_SM}px 10px`,
                    border: `1px solid ${t.BORDER_STRONG}`,
                    borderRadius: t.RADIUS,
                }}
            >
                <Skeleton width={16} height={16} borderRadius={3} />
                <Skeleton width={16} height={16} borderRadius={3} />
                <Skeleton width={120} height={14} />
            </div>
            <Skeleton width={50} height={11} style={{ marginBottom: t.GAP_SM }} />
            <div
                style={{
                    border: `1px solid ${t.BORDER_STRONG}`,
                    borderRadius: t.RADIUS,
                    overflow: 'hidden',
                }}
            >
                {[0.6, 0.45, 0.55, 0.5, 0.65].map((w, i) => (
                    <div
                        key={i}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: t.GAP_SM,
                            height: rowH,
                            padding: '0 10px',
                            ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}),
                        }}
                    >
                        <Skeleton width={`${w * 100}%`} height={14} style={{ maxWidth: 220 }} />
                        <Skeleton
                            width={50}
                            height={20}
                            borderRadius={t.RADIUS_PILL}
                            style={{ flex: 'none' }}
                        />
                    </div>
                ))}
            </div>
            <Skeleton width="100%" height={t.BUTTON_H} style={{ marginTop: t.GAP }} />
        </>
    );
}
