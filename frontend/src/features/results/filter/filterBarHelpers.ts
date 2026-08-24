import type {
    FilterCondition,
    FilterOperator,
    SqlDialect,
} from '../../../../../shared/protocol/index.ts';
import { quoteIdentifier, sqlLiteral } from '../../../common/db/sql.ts';
import { isCompleteCondition, operatorTakesValue } from './resultsFilterHelpers.ts';

/**
 * The operators offered, in the order they are offered.
 *
 * The labels are the SQL, because this is a SQL client and `<>` is what the user
 * would type in the raw box for the same thing. `≠` would be a second vocabulary
 * for one operator — the `dataType` rule again: show what the engine says rather
 * than translating it into something of ours.
 */
export const OPERATORS: FilterOperator[] = [
    '=',
    '<>',
    '>',
    '<',
    '>=',
    '<=',
    'LIKE',
    'IN',
    'IS NULL',
    'IS NOT NULL',
];

export const blankCondition = (column: string): FilterCondition => ({
    column,
    operator: '=',
    value: '',
});

/**
 * The builder's conditions written out as the `WHERE` text they mean, so
 * switching to raw starts from what was already on screen instead of a blank box.
 *
 * **Rendering rows as text is a fold over data we hold, and that is why this
 * direction is safe to do automatically.** It runs every time the raw box is
 * reached from the builder, so the text always reflects the conditions as they
 * stand — going back to builder never has to be able to undo it, because the
 * conditions themselves were never touched by it. See `FilterDraft` for why the
 * two forms can coexist rather than one overwriting the other.
 *
 * Two things this is careful about, because the text it produces really does
 * run once the user hits Apply:
 *
 * - **Values become quoted literals**, not bare text. The builder binds them as
 *   parameters and raw does not, so a straight concatenation would hand over
 *   `name = Ada` — not a value at all, but an identifier that does not exist.
 *   Quoting every value as a string literal is correct on both engines even for
 *   numbers, which take an unknown literal and coerce it.
 * - **Identifiers are quoted too**, per `quoteIdentifier` above — not left bare.
 *   The column came from the catalog (`filterColumns`, exactly as the engine
 *   spells it), so this is never a guess at spelling, only at whether quoting
 *   is *needed* — and unconditional quoting means it never has to guess that
 *   either.
 */
export function conditionsToWhere(
    conditions: FilterCondition[],
    conjunction: 'AND' | 'OR',
    dialect: SqlDialect,
): string {
    return conditions
        .filter(isCompleteCondition)
        .map((c) => {
            const column = quoteIdentifier(c.column, dialect);
            if (!operatorTakesValue(c.operator)) return `${column} ${c.operator}`;
            if (c.operator === 'IN') {
                const items = c.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0);
                return `${column} IN (${items.map(sqlLiteral).join(', ')})`;
            }
            return `${column} ${c.operator} ${sqlLiteral(c.value)}`;
        })
        .join(` ${conjunction} `);
}
