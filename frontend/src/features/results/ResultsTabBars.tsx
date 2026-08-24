import type { Tab } from '../../store/tabsSlice.ts';
import FilterBar from './filter/FilterBar.tsx';
import StatementTabs from './statement-tabs/StatementTabs.tsx';

interface Props {
    tab: Tab | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
}

/**
 * The two bars that belong to the *tab* rather than to whatever the grid is
 * currently showing, so they sit above every early return in `ResultsTable`.
 *
 * The filter is the older of the two and the reason is the sharper: a filter
 * the server rejects replaces the grid with an error, and a bar keyed off that
 * grid would vanish along with the one control that fixes it. The statement
 * strip is the same shape -- a batch that failed on Result 2 still has Result 1
 * to go back to, and the strip is how. Neither ever draws at the same time as
 * the other: the filter is a grid tab's and the strip needs two statements,
 * which only an editor tab can have.
 */
export default function ResultsTabBars({
    tab,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: Props) {
    return (
        <>
            <StatementTabs tab={tab} />
            <FilterBar
                tab={tab}
                databases={databases}
                onSelectDatabase={onSelectDatabase}
                pickerOpen={pickerOpen}
                onPickerOpenChange={onPickerOpenChange}
            />
        </>
    );
}
