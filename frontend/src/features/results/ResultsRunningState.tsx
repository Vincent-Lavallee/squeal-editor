import { ThinkingOrb } from 'thinking-orbs';
import Button from '../../common/components/Button.tsx';
import { cancelQuery } from '../../store/resultsSlice.ts';
import * as t from '../../common/tokens';
import GridSkeleton from './GridSkeleton.tsx';

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

interface Props {
    tabBars: React.ReactNode;
    elapsed: number;
    activeTabId: string | null;
}

export default function ResultsRunningState({ tabBars, elapsed, activeTabId }: Props) {
    return (
        <>
            {tabBars}
            <div data-testid="results-bar" style={barStyle}>
                <ThinkingOrb state="shaping" size={20} theme="dark" aria-label="Running" />
                <span>Running for {elapsed}s…</span>
                {activeTabId && (
                    <Button
                        variant="ghost"
                        style={{ height: 24, padding: '0 8px', marginLeft: 'auto' }}
                        onClick={() => cancelQuery(activeTabId)}
                    >
                        Cancel
                    </Button>
                )}
            </div>
            <GridSkeleton />
        </>
    );
}
