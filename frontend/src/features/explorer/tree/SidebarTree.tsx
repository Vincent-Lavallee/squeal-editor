import type { FunctionInfo } from '../../../../../shared/protocol/index.ts';
import { CATALOG_LIMIT } from '../../../store/explorerSlice.ts';
import * as t from '../../../common/tokens';
import TreeFlatList from './TreeFlatList.tsx';
import TreeGroupedList from './TreeGroupedList.tsx';
import TreePinnedGroup from './TreePinnedGroup.tsx';
import TreeStatusMessages from './TreeStatusMessages.tsx';
import type { useSidebarController } from '../sidebar/hooks/useSidebarController.ts';

interface Props {
    collapsed?: boolean;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    state: ReturnType<typeof useSidebarController>;
}

const truncatedMessage = (query: string): string =>
    query === ''
        ? `First ${CATALOG_LIMIT} of more — search to reach the rest.`
        : `First ${CATALOG_LIMIT} matches — narrow the search.`;

export default function SidebarTree({ collapsed, onShowFunctionDefinition, state: s }: Props) {
    return (
        <nav
            style={{
                flex: 1,
                overflowY: 'auto',
                padding: `${t.GAP_SM}px 6px`,
                display: collapsed ? 'none' : undefined,
            }}
        >
            <TreeStatusMessages
                firstLoad={s.firstLoad}
                error={s.error}
                showNoTables={s.query === '' && s.sorted?.length === 0}
                nothingMatched={s.nothingMatched}
                truncated={s.truncated}
                truncatedMessage={truncatedMessage(s.query)}
            />

            {s.ctx && s.pinned && s.pinned.length > 0 && (
                <TreePinnedGroup pinned={s.pinned} ctx={s.ctx} />
            )}

            {s.ctx && s.grouped && (
                <TreeGroupedList
                    grouped={s.grouped}
                    functionsBySchema={s.functionsBySchema}
                    query={s.query}
                    defaultSchema={s.defaultSchema}
                    schemaOpen={s.schemaOpen}
                    toggleSchema={s.toggleSchema}
                    openFunctions={s.openFunctions}
                    toggleFunctions={s.toggleFunctions}
                    onShowFunctionDefinition={onShowFunctionDefinition}
                    ctx={s.ctx}
                />
            )}

            {s.ctx && !s.grouped && (
                <TreeFlatList
                    unpinned={s.unpinned}
                    visibleFunctions={s.visibleFunctions}
                    functionsOpen={s.query !== '' || s.openFunctions.has('')}
                    onToggleFunctions={() => s.toggleFunctions('')}
                    onShowFunctionDefinition={onShowFunctionDefinition}
                    ctx={s.ctx}
                />
            )}
        </nav>
    );
}
