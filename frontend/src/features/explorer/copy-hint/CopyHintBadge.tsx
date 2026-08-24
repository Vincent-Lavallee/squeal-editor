import Badge from '../../../common/components/Badge.tsx';
import { CopiedIcon } from '../../../common/icons/icons.ts';

const iconSvg = { flex: 'none', width: 16, height: 16 };

/*
 * The badge recipe already used for the engine chip, not a one-off tooltip
 * box: a pill + checkmark reads as a toast rather than as a debug label, and
 * it pops in/out instead of snapping. The full database name stays out of it
 * on purpose -- a SQLite one is a full file path, easily wider than the
 * sidebar, and the confirmation is "it copied", not "here is what", which the
 * picker already shows.
 */
export default function CopyHintBadge({ hiding }: { hiding: boolean }) {
    return (
        <div
            role="status"
            data-testid="sidebar-db-copied"
            style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                zIndex: 50,
            }}
        >
            <Badge
                kind="green"
                style={{
                    animation: hiding
                        ? 'copy-hint-pop 0.16s ease-in reverse both'
                        : 'copy-hint-pop 0.16s ease-out both',
                }}
            >
                <CopiedIcon style={iconSvg} aria-hidden="true" />
                Copied
            </Badge>
        </div>
    );
}
