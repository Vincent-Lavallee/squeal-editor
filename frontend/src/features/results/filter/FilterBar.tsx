import type { Tab } from '../../../store/tabsSlice.ts';
import FilterActions from './FilterActions.tsx';
import FilterBuilderBar from './FilterBuilderBar.tsx';
import FilterRawBar from './FilterRawBar.tsx';
import { blankCondition } from './filterBarHelpers.ts';
import { useFilterBarState } from './hooks/useFilterBarState.ts';
import { useResults } from '../hooks/useResults.ts';

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

export default function FilterBar({
    tab,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: Props) {
    const results = useResults(tab);
    const { gridTable, applyFilter, running } = results;
    const { draft, columns, isRaw, conjunction, rows, setConditions, toRaw, toBuilder } =
        useFilterBarState(results);
    const database = tab?.database ?? null;

    // Filtering rides on the SQL the extension authored, so it is offered only
    // where that SQL exists -- the same boundary as the pager and the editable
    // grid. A query's result has no filter bar.
    //
    // Keyed off the tab's table rather than off `browse`, so a filter the server
    // rejected leaves the bar (and the draft) in place to be corrected.
    if (!gridTable) return null;

    const actions = (
        <FilterActions
            isRaw={isRaw}
            onAddCondition={() => setConditions([...rows, blankCondition(columns[0] ?? '')])}
            onToggleForm={isRaw ? toBuilder : toRaw}
            gridTable={gridTable}
            running={running}
            onApply={applyFilter}
            database={database}
            databases={databases}
            onSelectDatabase={onSelectDatabase}
            pickerOpen={pickerOpen}
            onPickerOpenChange={onPickerOpenChange}
        />
    );

    if (isRaw) {
        return (
            <FilterRawBar
                draft={draft}
                onDraftChange={results.setFilterDraft}
                onApply={applyFilter}
                actions={actions}
            />
        );
    }

    return (
        <FilterBuilderBar
            rows={rows}
            columns={columns}
            conjunction={conjunction}
            onConditionsChange={setConditions}
            onApply={applyFilter}
            actions={actions}
        />
    );
}
