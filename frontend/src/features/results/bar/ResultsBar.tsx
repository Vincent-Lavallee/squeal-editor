import Button from '../../../common/components/Button.tsx';
import * as t from '../../../common/tokens';
import type { useResultsGridController } from '../grid/hooks/useResultsGridController.ts';
import ResultsBarSummary from './ResultsBarSummary.tsx';
import ResultsPager from './ResultsPager.tsx';

const barStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    flex: 'none',
    padding: `0 ${t.GAP_LG}px`,
    height: 32,
    borderBottom: `1px solid ${t.BORDER}`,
    fontSize: t.TEXT_BADGE,
    color: t.TEXT_MUTED,
};

export default function ResultsBar({ g }: { g: ReturnType<typeof useResultsGridController> }) {
    return (
        <div data-testid="results-bar" style={barStyle}>
            <ResultsBarSummary
                gridDatabase={g.gridDatabase}
                browse={g.browse}
                count={g.count}
                firstRow={g.firstRow}
                durationMs={g.result!.durationMs}
                readOnlyReason={g.readOnlyReason}
                editBlockedHint={g.editBlockedHint}
            />

            <div
                style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, marginLeft: 'auto' }}
            >
                {/* Clear lives here rather than in the filter bar because it is a fact
              about the result on screen, and because it is the one filter control
              that is not needed to recover from a filter the server refused. */}
                {g.filterActive && (
                    <Button
                        variant="ghost"
                        data-testid="filter-clear"
                        style={{ height: 24, padding: '0 8px' }}
                        onClick={g.clearFilter}
                    >
                        Clear filter
                    </Button>
                )}

                {g.paged && g.browse && (
                    <ResultsPager browse={g.browse} onPrev={g.prev} onNext={g.next} />
                )}
            </div>
        </div>
    );
}
