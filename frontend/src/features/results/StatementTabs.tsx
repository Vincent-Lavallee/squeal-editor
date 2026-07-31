import { ThinkingOrb } from 'thinking-orbs';

import { useAppSelector } from '../../store/hooks.ts';
import { cancelQuery } from '../../store/resultsSlice.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';
import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';
import { useResults } from './useResults.ts';

/**
 * The numbered strip over a run that held more than one statement.
 *
 * **It draws nothing at all for one**, which is the whole of how a single
 * statement is unchanged from before this existed -- not a strip of one tab, no
 * strip. A browsed grid never reaches that bar either: the extension writes its
 * page SQL and there is exactly one statement in it.
 *
 * A tab appears because its statement *ran*, so the strip fills in as the batch
 * lands and stops where the batch stopped. `statementCount` is what says the
 * rest was there: a batch that halted at a failure ends with fewer tabs than
 * statements, and the trailing note is what keeps that from reading as
 * statements that were silently never in the text.
 *
 * Cancel lives here rather than only in the running pane because the two are not
 * the same question once a batch is plural -- Result 1's finished grid can be on
 * screen while Result 2 is still going, and the pane showing a grid has no
 * running state to hang a Cancel off.
 */
export default function StatementTabs() {
  const { statements, statementCount, activeStatement, selectStatement, tabRunning } = useResults();
  const activeTabId = useAppSelector(selectActiveTab)?.id ?? null;

  if (statementCount <= 1) return null;

  const notRun = statementCount - statements.length;

  return (
    <div data-testid="statement-tabs" role="tablist"
      style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', height: t.TAB_H, padding: `0 ${t.GAP_SM}px`, borderBottom: `1px solid ${t.BORDER}`, overflowX: 'auto', scrollbarWidth: 'none' }}>
      {statements.map((part, index) => {
        const active = index === activeStatement;
        return (
          <button key={index} data-testid="statement-tab" role="tab" aria-selected={active}
            onClick={() => selectStatement(index)}
            style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', height: 24, padding: `0 ${t.GAP_SM}px`, border: 'none', borderRadius: t.RADIUS, background: active ? t.SELECTED : 'transparent', color: active ? t.ACCENT : t.TEXT_MUTED, font: 'inherit', fontSize: t.TEXT_BADGE, cursor: 'pointer' }}>
            Result {index + 1}
            {part.running && <ThinkingOrb state="shaping" size={20} theme="dark" aria-label="Running" />}
            {/* Semantic, the one place a hue is allowed in the chrome: a failed
                statement is why the batch stopped, and the strip is where you
                are looking when you wonder which one it was. */}
            {part.error !== null && (
              <span data-testid="statement-failed" role="img" aria-label="Failed"
                style={{ width: 6, height: 6, borderRadius: t.RADIUS_PILL, background: t.RED }} />
            )}
          </button>
        );
      })}

      {notRun > 0 && (
        <span data-testid="statements-not-run" style={{ flex: 'none', color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>
          {notRun} not run
        </span>
      )}

      {tabRunning && activeTabId && (
        <Button variant="ghost" style={{ height: 24, padding: '0 8px', marginLeft: 'auto' }} onClick={() => cancelQuery(activeTabId)}>
          Cancel
        </Button>
      )}
    </div>
  );
}
