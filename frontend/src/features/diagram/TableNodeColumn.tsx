import { ForeignKeyIcon, KeyIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import type { DiagramNode } from './layout.ts';

const iconStyle = { flex: 'none', width: t.ICON, height: t.ICON } as const;

export default function TableNodeColumn({
    column,
    isForeignKey,
}: {
    column: DiagramNode['table']['columns'][number];
    isForeignKey: boolean;
}) {
    return (
        <span
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: t.ROW_H_TIGHT,
                padding: `0 ${t.GAP_SM}px`,
            }}
        >
            {/* The tree's two-stage shrink: the name keeps the default flex weight
              and the type a far higher one, so a long type gives up its width
              first and the name is the last thing to truncate. */}
            <span
                style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    fontFamily: t.MONO,
                    fontSize: t.TEXT_BADGE,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {column.name}
            </span>
            {column.primaryKey && (
                <KeyIcon style={{ ...iconStyle, color: t.TEXT_MUTED }} aria-label="primary key" />
            )}
            {isForeignKey && (
                <ForeignKeyIcon
                    style={{ ...iconStyle, color: t.TEXT_MUTED }}
                    aria-label="foreign key"
                />
            )}
            <span
                style={{
                    flex: '0 999 auto',
                    minWidth: 0,
                    marginLeft: 'auto',
                    overflow: 'hidden',
                    fontSize: t.TEXT_LABEL,
                    color: t.TEXT_FAINT,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {column.dataType}
            </span>
        </span>
    );
}
