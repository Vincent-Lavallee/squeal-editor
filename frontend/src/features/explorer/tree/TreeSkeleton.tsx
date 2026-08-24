import Skeleton from '../../../common/components/Skeleton.tsx';
import * as t from '../../../common/tokens';

/*
 * Its own testid rather than the `tree-note` its siblings share: the suite has
 * to be able to assert a refresh did *not* draw one, and "no note" would also
 * be true of a tree that had gone blank -- the very failure this replaced.
 */
export default function TreeSkeleton() {
    return (
        <div data-testid="tree-skeleton">
            {[0.55, 0.7, 0.45, 0.65, 0.5, 0.75, 0.4, 0.6].map((w, i) => (
                <div
                    key={i}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        height: t.ROW_H_DENSE,
                        padding: '0 6px',
                    }}
                >
                    <Skeleton width={16} height={16} borderRadius={3} style={{ flex: 'none' }} />
                    <Skeleton width={`${w * 100}%`} height={12} style={{ maxWidth: 180 }} />
                </div>
            ))}
        </div>
    );
}
