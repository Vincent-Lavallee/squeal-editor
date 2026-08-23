import { ThinkingOrb } from 'thinking-orbs';

import * as t from '../../common/tokens';
import type { ResultsState } from '../../store/resultsSlice.ts';

const buttonStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_XS,
    flex: 'none',
    height: 24,
    padding: `0 ${t.GAP_SM}px`,
    border: 'none',
    borderRadius: t.RADIUS,
    background: active ? t.SELECTED : 'transparent',
    color: active ? t.ACCENT : t.TEXT_MUTED,
    font: 'inherit',
    fontSize: t.TEXT_BADGE,
    cursor: 'pointer',
});

const failedDotStyle: React.CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: t.RADIUS_PILL,
    background: t.RED,
};

interface Props {
    part: ResultsState;
    index: number;
    active: boolean;
    onSelect: () => void;
}

export default function StatementTabButton({ part, index, active, onSelect }: Props) {
    return (
        <button
            data-testid="statement-tab"
            role="tab"
            aria-selected={active}
            onClick={onSelect}
            style={buttonStyle(active)}
        >
            Result {index + 1}
            {part.running && (
                <ThinkingOrb state="shaping" size={20} theme="dark" aria-label="Running" />
            )}
            {/* Semantic, the one place a hue is allowed in the chrome: a failed
          statement is why the batch stopped, and the strip is where you are
          looking when you wonder which one it was. */}
            {part.error !== null && (
                <span
                    data-testid="statement-failed"
                    role="img"
                    aria-label="Failed"
                    style={failedDotStyle}
                />
            )}
        </button>
    );
}
