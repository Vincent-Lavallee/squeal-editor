import { DisclosureIcon, SchemaIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

export default function TreeSchemaRowHeader({
    schema,
    count,
    open,
    onToggle,
}: {
    schema: string;
    count: number;
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            data-testid="tree-schema-row"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                height: t.ROW_H_DENSE,
                padding: '0 6px 0 0',
                border: 'none',
                background: 'none',
                color: t.TEXT_MUTED,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: t.RADIUS,
            }}
            onClick={onToggle}
            aria-expanded={open}
            title={`${schema} — ${count} ${count === 1 ? 'item' : 'items'}`}
        >
            <DisclosureIcon
                style={{
                    width: 16,
                    height: 16,
                    flex: 'none',
                    color: t.TEXT_FAINT,
                    transition: 'transform 0.12s ease',
                    ...(open ? { transform: 'rotate(90deg)' } : {}),
                }}
                aria-hidden="true"
            />
            <SchemaIcon style={{ width: 16, height: 16, color: t.TEXT_MUTED }} aria-hidden="true" />
            <span
                data-testid="tree-schema-label"
                style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {schema}
            </span>
        </button>
    );
}
