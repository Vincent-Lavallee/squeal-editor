import Note from '../../common/components/Note.tsx';
import * as t from '../../common/tokens';
import { emptyCtr, headingStyle } from './resultsEmptyStateStyles.ts';

export default function ResultsNoRowsYet({ tabBars }: { tabBars: React.ReactNode }) {
    return (
        <>
            {tabBars}
            <div style={emptyCtr}>
                <div style={headingStyle(t.TEXT_FAINT)}>No results yet</div>
                <Note kind="muted">Run a query to see results.</Note>
            </div>
        </>
    );
}
