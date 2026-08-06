import type { FilterCondition, FilterOperator, SqlDialect } from '../../../../shared/protocol/index.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Select from '../../common/components/Select.tsx';
import { quoteIdentifier, sqlLiteral } from '../../common/db/sql.ts';
import type { Tab } from '../../store/tabsSlice.ts';
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
/**
 * The tracks, and the two minimums that are load-bearing.
 *
 * **The value box has a floor of its own** (`minmax(120px, 1fr)`, not a bare
 * `1fr`): a `1fr` track is free to shrink to nothing once everything beside it
 * has claimed its minimum, which is what a split pane does -- half the width,
 * the same fixed lead, column, operator, remove and action cells, and whatever
 * is left over goes to the one control you actually type into. It went to a
 * few pixels. A floor means the bar overflows instead, which the container
 * below scrolls.
 *
 * **120px and not more**, because the floor is also what pushes *Search* off
 * the end: every pixel the value box is guaranteed is one the actions cell
 * cannot have, and the action that runs the filter is worth more on screen
 * than a wider box. At 120 both fit across a pane down to about 500px -- half
 * of the smallest window this app is used in -- and below that the bar
 * scrolls rather than either one being crushed.
 *
 * The column and operator minimums are lower than they look because they are
 * `<Select>`s: they show a truncated value at 70px and stay usable, while the
 * value box at 70px does not.
 */
const GRID_COLUMNS = '52px minmax(70px, 150px) minmax(64px, 104px) minmax(120px, 1fr) 26px auto';

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

/*
 * Search, and the caret that says where it searches: the editor toolbar's run
 * group, at this bar's control height. One shape rather than two buttons that
 * touch -- the group carries the accent fill and the rounded ends, the halves
 * inside it draw neither, and the divider is 1px of the fill's own foreground
 * where a `--border` grey would read as a gap. See `docs/design-system.md`.
 *
 * The caret is the whole of the attached half here too: the database's name is
 * stated once, in the results bar below, for the reason it is stated in the
 * editor's toolbar rather than inside Run.
 */
const searchGroup: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'stretch',
  height: CONTROL_H,
  borderRadius: t.RADIUS,
  background: t.ACCENT,
  color: t.ON_ACCENT,
  overflow: 'hidden',
};

const searchHalf: React.CSSProperties = {
  height: '100%',
  padding: '0 8px',
  border: 'none',
  borderRadius: 0,
  background: 'none',
  color: 'inherit',
};

const searchDivider: React.CSSProperties = {
  flex: 'none',
  width: 1,
  background: 'color-mix(in srgb, currentColor 35%, transparent)',
};

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

interface Props {
  tab: Tab | null;
  /**
   * Every database of this tab's connection, and the way to point the tab at
   * one of them -- the editor toolbar's pair, handed down the same way and for
   * the same reason: the explorer is a sibling feature, and the shell already
   * holds both.
   */
  databases: string[];
  onSelectDatabase: (database: string) => void;
  /**
   * Whether this pane's database list is showing. Controlled by the shell,
   * because the keyboard is the other way in and only the shell knows which
   * pane a chord is meant for.
   */
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
}

export default function FilterBar({ tab, databases, onSelectDatabase, pickerOpen, onPickerOpenChange }: Props) {
  const { gridTable, filterColumns, filterDraft, setFilterDraft, applyFilter, running, dialect } = useResults(tab);
  const database = tab?.database ?? null;

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
   * Search and the form toggle sit on the first row rather than in the results
   * bar below, and that is not a layout preference: a filter the server rejects
   * replaces the results bar with the error, so a control drawn only there would
   * disappear exactly when it is needed to fix what caused it. *Clear* is in the
   * results bar precisely because it is not needed to recover -- emptying the
   * row and searching again does the same thing.
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

      <div style={searchGroup} data-testid="search-group">
        {/* Enabled whether or not the draft has moved since it last ran: an
            unchanged search re-reads the table, which is the cheapest way to
            ask "has this changed" and the reason this reads Search rather than
            Apply. Only a request already in flight takes it away. */}
        <Button
          variant="primary"
          data-testid="filter-apply"
          style={searchHalf}
          disabled={running}
          title={`Read ${gridTable} again, with these conditions`}
          onClick={applyFilter}
        >
          Search
        </Button>
        <div style={searchDivider} aria-hidden="true" />
        {/* `align="end"` for the run group's reason: the caret sits near the
            pane's right edge, so a left-aligned list grows away from the pane
            it belongs to -- and in a split, across the other one. */}
        <Select variant="attached" caretOnly searchable align="end" value={database ?? ''} onSelect={onSelectDatabase}
          open={pickerOpen} onOpenChange={onPickerOpenChange}
          options={databases.map((db) => ({ value: db, label: db }))}
          disabled={databases.length === 0} aria-label="Database this tab reads from"
          data-testid="grid-db-select"
          title={database ? `Reads from ${database}` : 'Pick a database'}
          style={{ padding: `0 ${t.GAP_XS}px` }} />
      </div>
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
    // Narrower than its own tracks want to be -- a split pane -- and the bar
    // scrolls sideways rather than crushing the value box to nothing. It is
    // still one line per condition: this is the same refusal to grow a second
    // row of buttons, answered for the width instead of the height.
    overflowX: 'auto',
    scrollbarWidth: 'none',
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
