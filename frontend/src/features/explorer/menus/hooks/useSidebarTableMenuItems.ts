import type { TableInfo } from '../../../../../../shared/protocol/index.ts';
import { relationLabel, relationOf } from '../../../../common/db/relation.ts';
import type { MenuItem } from '../../../../common/components/ContextMenu.tsx';
import type { useExplorer } from '../../hooks/useExplorer.ts';

const copyName = (name: string) => void Neutralino.clipboard.writeText(name);

interface Options {
    isStarred: ReturnType<typeof useExplorer>['isStarred'];
    toggleStar: ReturnType<typeof useExplorer>['toggleStar'];
    readOnly: boolean;
    defaultSchema: string | undefined;
    onShowDefinition: (database: string, table: TableInfo) => void;
    onDrop: (table: TableInfo) => void;
}

/** What a table or view's right-click menu offers. Split out of `Sidebar`
 *  purely for length. */
export function useSidebarTableMenuItems({
    isStarred,
    toggleStar,
    readOnly,
    defaultSchema,
    onShowDefinition,
    onDrop,
}: Options) {
    // Drop is refused on a read-only connection: read-only is the server refusing
    // writes, and that does not reliably cover DDL, so honouring the intent for a
    // `DROP` is the UI's to do.
    const menuItems = (table: TableInfo, db: string): MenuItem[] => {
        const starred = isStarred(db, relationOf(table));
        return [
            // The name as it reads, not the cache's key: what lands on the clipboard is
            // what you would type, and `public.` is not something anyone types.
            {
                label: 'Copy name',
                onSelect: () => copyName(relationLabel(relationOf(table), defaultSchema)),
            },
            { label: 'Open definition', onSelect: () => onShowDefinition(db, table) },
            {
                label: starred ? 'Unstar' : 'Star',
                onSelect: () => toggleStar(db, relationOf(table), !starred),
            },
            {
                label: `Drop ${table.kind === 'view' ? 'view' : 'table'}`,
                danger: true,
                disabled: readOnly,
                title: readOnly ? 'This connection is read-only.' : undefined,
                onSelect: () => onDrop(table),
            },
        ];
    };

    return { menuItems };
}
