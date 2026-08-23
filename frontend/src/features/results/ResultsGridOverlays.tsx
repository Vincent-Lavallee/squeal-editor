import type { QueryResult } from '../../../../shared/protocol/index.ts';
import ContextMenu from '../../common/components/ContextMenu.tsx';
import type { useResultsGridController } from './useResultsGridController.ts';
import JsonCellDrawer from './JsonCellDrawer.tsx';

interface Props {
    g: ReturnType<typeof useResultsGridController>;
    result: QueryResult;
}

export default function ResultsGridOverlays({ g, result }: Props) {
    return (
        <>
            {/* While a column is being dragged the cursor is `col-resize` everywhere,
          not only over the 8px strip it left behind on the first fast move. */}
            {g.resizing && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 50, cursor: 'col-resize' }} />
            )}

            {g.menu && (
                <ContextMenu
                    x={g.menu.x}
                    y={g.menu.y}
                    items={g.menuItems(g.menu)}
                    onClose={() => g.setMenu(null)}
                />
            )}

            {g.jsonEditing && (
                <JsonCellDrawer
                    column={result.columns[g.jsonEditing.col] ?? ''}
                    dataType={g.typeOf(result.columns[g.jsonEditing.col] ?? '')}
                    initial={g.effective(g.jsonEditing.row, g.jsonEditing.col)}
                    canNull={!g.isKeyCol(g.jsonEditing.col)}
                    onCommit={(draft) => {
                        g.applyEdit(g.jsonEditing!.row, g.jsonEditing!.col, draft);
                        g.setJsonEditing(null);
                    }}
                    onNull={() => {
                        g.applyNull(g.jsonEditing!.row, g.jsonEditing!.col);
                        g.setJsonEditing(null);
                    }}
                    onCancel={() => g.setJsonEditing(null)}
                />
            )}
        </>
    );
}
