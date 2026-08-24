import type { TableInfo } from '../../../../../shared/protocol/index.ts';
import { TableIcon, ViewIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    table: TableInfo;
    label: string;
    qualifiedName: string;
    onSelect: () => void;
}

export default function TreeNameButton({ table, label, qualifiedName, onSelect }: Props) {
    return (
        <button
            data-testid="tree-name"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flex: 1,
                minWidth: 0,
                height: '100%',
                padding: '0 6px 0 0',
                border: 'none',
                background: 'none',
                color: t.TEXT,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                textAlign: 'left',
                cursor: 'pointer',
            }}
            onClick={onSelect}
            title={`${qualifiedName} — click to browse`}
        >
            {table.kind === 'view' ? (
                <ViewIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
            ) : (
                <TableIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
            )}
            <span
                data-testid="tree-label"
                style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {label}
            </span>
        </button>
    );
}
