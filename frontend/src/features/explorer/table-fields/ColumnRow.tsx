import type { ColumnInfo } from '../../../../../shared/protocol/index.ts';
import { KeyIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function ColumnRow({ column, pad }: { column: ColumnInfo; pad: number }) {
    return (
        <li
            data-testid="tree-col"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: t.ROW_H_TIGHT,
                padding: `0 6px 0 ${pad}px`,
            }}
            title={`${column.name} ${column.dataType}${column.primaryKey ? ' · primary key' : ''}`}
        >
            {/*
             * The name keeps `flex-shrink: 1` (the default weight) and the type
             * a wildly higher one, so flexbox's proportional shrink -- which
             * would otherwise clip both together as the sidebar narrows -- gives
             * nearly all of the negative space to the type first. The type
             * reaches its `minWidth: 0` floor (invisible) long before the name
             * loses a pixel; only once it is fully gone does the name start to
             * truncate, which is the two-stage priority asked for without
             * measuring anything in JS.
             */}
            <span
                data-testid="tree-col-name"
                style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: t.TEXT_BADGE,
                    color: t.TEXT,
                    fontFamily: t.MONO,
                }}
            >
                {column.name}
            </span>
            {column.primaryKey && (
                <KeyIcon
                    data-testid="tree-key"
                    style={{ ...iconSvg, flex: 'none', color: t.TEXT_MUTED }}
                    aria-label="primary key"
                />
            )}
            <span
                style={{
                    flex: '0 999 auto',
                    minWidth: 0,
                    marginLeft: 'auto',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: t.TEXT_BADGE,
                    color: t.TEXT_MUTED,
                }}
            >
                {column.dataType}
            </span>
        </li>
    );
}
