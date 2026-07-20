import type { FilterCondition, FilterOperator, SqlDialect } from '../../../../shared/protocol/index.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Select from '../../common/components/Select.tsx';
import * as t from '../../common/tokens';
import { isCompleteCondition, operatorTakesValue, useResults } from './useResults.ts';

/**
 * The operators offered, in the order they are offered.
 *
 * The labels are the SQL, because this is a SQL client and `<>` is what the user
 * would type in the raw box for the same thing. `≠` would be a second vocabulary
 * for one operator — the `dataType` rule again: show what the engine says rather
 * than translating it into something of ours.
 */
const OPERATORS: FilterOperator[] = ['=', '<>', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

/**
 * One row per condition and nothing else.
 *
 * Every row is the same grid, so the controls line up down the bar, and the
 * actions occupy a trailing cell that only the first row fills. A row of buttons
 * *beneath* the conditions would double the height of the bar to say things that
 * fit on the line already there.
 */
const GRID_COLUMNS = '52px minmax(90px, 150px) minmax(72px, 104px) 1fr 26px auto';

const CONTROL_H = 22;
const controlStyle: React.CSSProperties = { height: CONTROL_H, fontSize: t.TEXT_BADGE };
const valueStyle: React.CSSProperties = { ...controlStyle, fontFamily: t.MONO, padding: '0 6px' };
const leadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: CONTROL_H,
  color: t.TEXT_FAINT,
  fontFamily: t.MONO,
  fontSize: t.TEXT_BADGE,
};

/**
 * The add/remove pair. They are glyphs rather than words, so they carry the
 * click target on the glyph's size — a 12px `−` in a 22px box is a dot you aim
 * at. Bigger type, `lineHeight: 1` so it does not push the row's height past the
 * other controls, and the grid track widened to match.
 */
const iconBtn: React.CSSProperties = {
  height: CONTROL_H,
  padding: '0 5px',
  minWidth: 0,
  fontSize: 15,
  lineHeight: 1,
};

const blankCondition = (column: string): FilterCondition => ({ column, operator: '=', value: '' });

/**
 * The conjunction select: narrower, unbolded, and a genuine step down in type
 * size from the fields it leads -- not just a smaller box around the same 12px
 * word. It answers one binary question under WHERE, not a value in its own
 * right, so it should read as quieter than the column/operator/value beside it.
 *
 * The 10px is a literal rather than a named token on purpose, the same call
 * `iconBtn`'s 15px makes below: this is the one control in the design system
 * outside the connection rail small enough to want it, and `TEXT_MICRO` is
 * documented as the rail's alone. Reusing it here would be quietly widening
 * that token's meaning instead of deciding to.
 */
const conjunctionStyle: React.CSSProperties = {
  height: CONTROL_H,
  // It fills its whole track rather than the 46px it took when the browser drew
  // its arrow: the app's caret is a 16px icon, and there is one icon size on
  // purpose. `AND` at 10px plus that mark needs every pixel the lead has, so the
  // gap goes and the padding is the little that is left.
  width: '100%',
  gap: 0,
  padding: '0 0 0 3px',
  fontSize: 10,
  fontWeight: 400,
  color: t.TEXT_FAINT,
};

/** A value as a SQL string literal, with embedded quotes doubled per the standard. */
const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Quotes an identifier the way this dialect's own driver would.
 *
 * Mirrors `Driver.quoteIdent` in `extensions/db/drivers.ts` exactly — backtick
 * for MySQL, double quote (the ANSI default, and every other engine this app
 * or a future one is likely to speak) otherwise, each escaping an embedded
 * instance of its own quote character by doubling it. `SqlDialect` is already
 * the frontend's to read: it is what `EditorPane` hands Monaco for
 * highlighting and what `format.ts` maps to a formatter language, so reading
 * it a third time here to answer "which character quotes an identifier"
 * follows the same pattern rather than inventing a new one.
 *
 * **Unconditional, the same call `quoteIdent` already makes.** A plain
 * lowercase name gains quotes it did not strictly need; an unquoted
 * mixed-case or reserved-word name is the bug this exists to prevent —
 * Postgres folds an unquoted identifier to lowercase, so `eventType` typed
 * bare becomes a lookup for a column named `eventtype`, which does not exist.
 */
function quoteIdentifier(name: string, dialect: SqlDialect): string {
  return dialect === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
}

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
function conditionsToWhere(conditions: FilterCondition[], conjunction: 'AND' | 'OR', dialect: SqlDialect): string {
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

export default function FilterBar() {
  const { gridTable, filterColumns, filterDraft, setFilterDraft, filterDirty, applyFilter, running, dialect } = useResults();

  // Filtering rides on the SQL the extension authored, so it is offered only
  // where that SQL exists -- the same boundary as the pager and the editable
  // grid. A query's result has no filter bar.
  //
  // Keyed off the tab's table rather than off `browse`, so a filter the server
  // rejected leaves the bar (and the draft) in place to be corrected.
  if (!gridTable) return null;

  // `filterColumns`, not `columnInfo`: it is what survived a failed browse (see
  // `useResults`), which is exactly the moment this dropdown has to keep working
  // -- the failure the bar exists to let someone fix.
  const columns = filterColumns.map((c) => c.name);

  const draft = filterDraft;
  const isRaw = draft.mode === 'raw';
  const conjunction = draft.conjunction;

  const setConditions = (conditions: FilterCondition[], nextConjunction = conjunction) =>
    setFilterDraft({ ...draft, conditions, conjunction: nextConjunction });

  /*
   * The bar always shows a row, so an untouched builder renders one that is not
   * in the draft yet. Editing it is what materialises it: every writer below
   * maps over `rows` rather than over the draft's own array, so the first
   * keystroke turns the placeholder into a real condition. `useResults` prunes
   * incomplete rows before anything runs, which is what stops a bar nobody has
   * touched from being a filter nobody asked for.
   */
  const rows = draft.conditions.length > 0 ? draft.conditions : [blankCondition(columns[0] ?? '')];

  const updateCondition = (index: number, patch: Partial<FilterCondition>) =>
    setConditions(rows.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const addCondition = () => setConditions([...rows, blankCondition(columns[0] ?? '')]);

  // Removing the only row leaves none stored, which renders as the blank row
  // again -- so the bar never collapses to nothing and there is always a way in.
  const removeCondition = (index: number) => setConditions(rows.filter((_, i) => i !== index));

  /*
   * Switching form changes `mode` and nothing else the other side is holding.
   * **Neither direction may discard the other's work** -- that was the bug: raw
   * → builder used to reset `conditions` to `[]`, so building a filter, glancing
   * at its raw text, and switching back threw the builder away. Now `toBuilder`
   * touches only `mode`, so whatever was in `conditions` is exactly what is
   * still there. `toRaw` still refreshes `where` from the current conditions --
   * safe to do every time, because it never reads from or writes to the
   * conditions themselves, only renders them (see `conditionsToWhere`).
   */
  const toRaw = () => setFilterDraft({ ...draft, mode: 'raw', where: conditionsToWhere(rows, conjunction, dialect) });
  const toBuilder = () => setFilterDraft({ ...draft, mode: 'builder' });

  /*
   * Apply and the form toggle sit on the first row rather than in the results
   * bar below, and that is not a layout preference: a filter the server rejects
   * replaces the results bar with the error, so a control drawn only there would
   * disappear exactly when it is needed to fix what caused it. *Clear* is in the
   * results bar precisely because it is not needed to recover -- emptying the
   * row and applying does the same thing.
   */
  const actions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS }}>
      {!isRaw && (
        <Button variant="ghost" data-testid="filter-add" style={iconBtn} title="Add a condition" onClick={addCondition}>
          +
        </Button>
      )}
      <Button
        variant="ghost"
        data-testid="filter-toggle-form"
        style={{ height: CONTROL_H, padding: '0 6px' }}
        title={isRaw ? 'Back to the condition builder' : 'Write the WHERE clause yourself'}
        onClick={isRaw ? toBuilder : toRaw}
      >
        {isRaw ? 'Builder' : 'Raw'}
      </Button>
      {/* Reload is user-initiated: nothing typed here has touched the database.
          Disabled when the draft already matches what is applied, so the button
          itself says whether there is anything left to run. */}
      <Button
        variant="primary"
        data-testid="filter-apply"
        style={{ height: CONTROL_H, padding: '0 8px' }}
        disabled={running || !filterDirty}
        onClick={applyFilter}
      >
        Apply
      </Button>
    </div>
  );

  const barStyle: React.CSSProperties = {
    display: 'grid',
    gap: t.GAP_XS,
    alignItems: 'center',
    flex: 'none',
    padding: `4px ${t.GAP_LG}px`,
    borderBottom: `1px solid ${t.BORDER}`,
    fontSize: t.TEXT_BADGE,
    color: t.TEXT_MUTED,
  };

  if (isRaw) {
    return (
      <div data-testid="results-filterbar" style={{ ...barStyle, gridTemplateColumns: '52px 1fr auto' }}>
        <span style={leadStyle}>WHERE</span>
        <Input
          data-testid="filter-raw"
          style={valueStyle}
          placeholder="created_at > now() - interval '7 days'"
          value={draft.where}
          onChange={(e) => setFilterDraft({ ...draft, where: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter();
          }}
        />
        {actions}
      </div>
    );
  }

  return (
    <div data-testid="results-filterbar" style={{ ...barStyle, gridTemplateColumns: GRID_COLUMNS }}>
      {rows.map((condition, index) => (
        // `display: contents` so each condition is one element to read here and
        // no element at all to the grid -- its children are the row's cells.
        <div key={index} data-testid="filter-condition" style={{ display: 'contents' }}>
          {index === 0 ? (
            <span style={leadStyle}>WHERE</span>
          ) : (
            // Rows past the first lead with the conjunction, which is one value
            // for the whole set -- changing any changes all, because that is what
            // it is. Mixed logic is the raw clause's job, not a per-row choice.
            <Select
              variant="bare"
              data-testid="filter-conjunction"
              style={conjunctionStyle}
              title="How the conditions combine"
              value={conjunction}
              options={[{ value: 'AND', label: 'AND' }, { value: 'OR', label: 'OR' }]}
              onSelect={(value) => setConditions(rows, value as 'AND' | 'OR')}
            />
          )}

          <Select
            data-testid="filter-column"
            style={controlStyle}
            value={condition.column}
            // A column the page no longer has (the tab moved database) still
            // renders, rather than silently snapping to the first column and
            // changing what the filter means without saying so.
            options={[
              ...(condition.column !== '' && !columns.includes(condition.column) ? [{ value: condition.column, label: condition.column }] : []),
              ...columns.map((name) => ({ value: name, label: name })),
            ]}
            onSelect={(value) => updateCondition(index, { column: value })}
          />

          <Select
            data-testid="filter-operator"
            style={controlStyle}
            value={condition.operator}
            options={OPERATORS.map((operator) => ({ value: operator, label: operator }))}
            onSelect={(value) => updateCondition(index, { operator: value as FilterOperator })}
          />


          {operatorTakesValue(condition.operator) ? (
            <Input
              data-testid="filter-value"
              style={valueStyle}
              placeholder={condition.operator === 'IN' ? 'a, b, c' : 'value'}
              value={condition.value}
              onChange={(e) => updateCondition(index, { value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilter();
              }}
            />
          ) : (
            // The cell still has to be occupied or the grid pulls everything
            // after it leftwards on this row alone, and the columns stop lining up.
            <span />
          )}

          <Button
            variant="ghost"
            data-testid="filter-remove"
            style={iconBtn}
            title="Remove this condition"
            onClick={() => removeCondition(index)}
          >
            {/* A minus, not a cross: it is the pair of the `+` beside it and
                removes a row, where a × reads as dismissing the bar itself.
                U+2212, so it matches the plus's weight rather than sitting high
                and short like a hyphen. */}
            −
          </Button>

          {index === 0 ? actions : <span />}
        </div>
      ))}
    </div>
  );
}
