import Note from '../../common/components/Note.tsx';
import * as t from '../../common/tokens';
import { emptyCtr, headingStyle } from './resultsEmptyStateStyles.ts';

export default function ResultsQueryFinished({
    tabBars,
    message,
}: {
    tabBars: React.ReactNode;
    message: string | undefined;
}) {
    return (
        <>
            {tabBars}
            <div style={emptyCtr}>
                <div style={headingStyle(t.GREEN)}>Query finished</div>
                <Note kind="ok">{message}</Note>
            </div>
        </>
    );
}
