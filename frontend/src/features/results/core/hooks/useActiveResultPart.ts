import { useAppSelector } from '../../../../store/hooks.ts';
import { activePart, type ResultsState } from '../../../../store/resultsSlice.ts';

/** A tab that has never run anything has no entry, and this is what it reads as. */
const EMPTY = Object.freeze({
    result: null,
    browse: null,
    editTarget: null,
    sql: null,
    sort: null,
    error: null,
    errorSql: null,
    running: false,
    startedAt: null,
    columns: [],
});

/** Its plural, for the same reason: a tab with no results reads as a stable empty list. */
const NO_STATEMENTS: readonly ResultsState[] = Object.freeze([]);

/**
 * A tab holds a list of results now -- one per statement the last run held --
 * and this reads the one in front, plus the strip's own view of the whole
 * list. Split out of `useResults` purely for length.
 *
 * A browsed page and a single statement are both lists of one, so every rule
 * elsewhere about "the result" is unchanged by there sometimes being a second.
 */
export function useActiveResultPart(activeTabId: string | null) {
    const tabResults = useAppSelector((s) => (activeTabId ? s.results[activeTabId] : undefined));
    const statements = tabResults?.parts ?? NO_STATEMENTS;
    const activeStatement = tabResults?.active ?? 0;
    const statementCount = tabResults?.statementCount ?? 1;
    // Counted on the tab rather than on a statement, so it survives a new batch --
    // see `TabResults.runSeq` for what starting it over would carry across.
    const runSeq = tabResults?.runSeq ?? 0;
    // The tab is busy while *any* statement of the batch is, which is not the same
    // question as whether the one on screen is: the pane can be showing a finished
    // Result 1 while Result 2 is still going. Run and Cancel answer to this one.
    const tabRunning = statements.some((part) => part.running);

    return {
        statements,
        activeStatement,
        statementCount,
        runSeq,
        tabRunning,
        ...(activePart(tabResults) ?? EMPTY),
    };
}
