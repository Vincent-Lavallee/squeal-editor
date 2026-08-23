import type { TableInfo } from '../../../../shared/protocol/index.ts';
import * as t from '../../common/tokens';
import TreeNameButton from './TreeNameButton.tsx';
import TreeToggleButton from './TreeToggleButton.tsx';

interface Props {
    table: TableInfo;
    label: string;
    qualifiedName: string;
    indented: boolean;
    open: boolean;
    onToggle: () => void;
    onSelect: () => void;
    onContextMenu: (x: number, y: number) => void;
}

export default function TreeRowHeader({
    table,
    label,
    qualifiedName,
    indented,
    open,
    onToggle,
    onSelect,
    onContextMenu,
}: Props) {
    return (
        <div
            data-testid="tree-row"
            style={{
                display: 'flex',
                alignItems: 'center',
                height: t.ROW_H_DENSE,
                borderRadius: t.RADIUS,
                paddingLeft: indented ? 12 : 0,
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(e.clientX, e.clientY);
            }}
        >
            <TreeToggleButton label={label} open={open} onToggle={onToggle} />
            <TreeNameButton
                table={table}
                label={label}
                qualifiedName={qualifiedName}
                onSelect={onSelect}
            />
        </div>
    );
}
