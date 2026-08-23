import type { Tab } from '../../store/tabsSlice.ts';
import ResultsBar from './ResultsBar.tsx';
import ResultsErrorState from './ResultsErrorState.tsx';
import ResultsGridOverlays from './ResultsGridOverlays.tsx';
import ResultsGridScrollArea from './ResultsGridScrollArea.tsx';
import ResultsNoRowsYet from './ResultsNoRowsYet.tsx';
import ResultsQueryFinished from './ResultsQueryFinished.tsx';
import ResultsRunningState from './ResultsRunningState.tsx';
import ResultsSaveBar from './ResultsSaveBar.tsx';
import ResultsTabBars from './ResultsTabBars.tsx';
import { useResultsGridController } from './useResultsGridController.ts';

interface Props {
    tab: Tab | null;
    /**
     * The filter bar's database picker, passed straight through: the bar is this
     * component's to draw but the list and the pointing are the shell's, exactly
     * as the editor toolbar's picker is. Nothing here reads them.
     */
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
    /**
     * Hand this failure to the assistant. Absent when there is no key stored, in
     * which case the button is not drawn at all.
     *
     * It spans the tabs and the assistant, so it is `Shell`'s -- this component
     * reports the failure and never composes the question, the same rule that
     * keeps it from importing a sibling feature.
     */
    onDiagnose?: (failure: { sql: string | null; error: string }) => void;
}

export default function ResultsTable({
    tab,
    onDiagnose,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: Props) {
    const g = useResultsGridController(tab);

    const tabBars = (
        <ResultsTabBars
            tab={tab}
            databases={databases}
            onSelectDatabase={onSelectDatabase}
            pickerOpen={pickerOpen}
            onPickerOpenChange={onPickerOpenChange}
        />
    );

    if (g.running)
        return (
            <ResultsRunningState
                tabBars={tabBars}
                elapsed={g.elapsed}
                activeTabId={g.activeTabId}
            />
        );
    if (g.error)
        return (
            <ResultsErrorState
                tabBars={tabBars}
                error={g.error}
                errorSql={g.errorSql}
                onDiagnose={onDiagnose}
            />
        );
    if (!g.result) return <ResultsNoRowsYet tabBars={tabBars} />;
    if (g.result.columns.length === 0)
        return <ResultsQueryFinished tabBars={tabBars} message={g.result.message} />;

    return (
        <>
            {tabBars}
            <ResultsBar g={g} />

            {(g.dirtyCount > 0 || g.saving || g.saveError) && (
                <ResultsSaveBar
                    dirtyCount={g.dirtyCount}
                    saving={g.saving}
                    saveError={g.saveError}
                    onDiscard={g.discard}
                    onSave={() => void g.save()}
                />
            )}

            <ResultsGridScrollArea g={g} result={g.result} />

            <ResultsGridOverlays g={g} result={g.result} />
        </>
    );
}
