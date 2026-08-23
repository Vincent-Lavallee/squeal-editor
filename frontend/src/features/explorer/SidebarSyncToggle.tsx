import Button from '../../common/components/Button.tsx';
import { SyncTreeIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    synced: boolean;
    onToggleSync: () => void;
}

/*
 * Unlike every other toggle in this bar's history, it is drawn on every
 * engine: what it pairs is the tree and the tab, which every connection
 * has, rather than a schema layer only some of them report.
 */
export default function SidebarSyncToggle({ synced, onToggleSync }: Props) {
    return (
        <Button
            variant="ghost"
            style={{
                justifyContent: 'center',
                flex: 'none',
                width: 24,
                height: 24,
                padding: 0,
                ...(synced ? { color: t.ACCENT } : {}),
            }}
            onClick={onToggleSync}
            title={
                synced
                    ? 'The tree follows the tab in front (Ctrl+Shift+B)'
                    : "Keep the tree on the tab's database (Ctrl+Shift+B)"
            }
            aria-label={
                synced ? 'Stop the tree following the tab' : "Keep the tree on the tab's database"
            }
            aria-pressed={synced}
            data-testid="sidebar-sync-toggle"
        >
            <SyncTreeIcon style={iconSvg} aria-hidden="true" />
        </Button>
    );
}
