import { useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import { formatChord } from '../../common/shortcuts.ts';
import { useShortcuts } from '../../store/settingsSlice.ts';
import DiagramView from './DiagramView.tsx';
import { useDiagram } from './useDiagram.ts';
import { useDiagramCanvas } from './useDiagramCanvas.ts';

interface Props {
    /** The tab this diagram is, so it draws the database that tab is pointed at. */
    tab: Tab;
    /**
     * Open a table, **on this diagram's own database** rather than on whatever
     * the tree happens to be showing: a diagram is a picture of one database, so
     * a node clicked in it can only mean that database's table. Leaving the
     * caller to infer it opened a grid pointed somewhere the table may not exist.
     */
    onOpenTable: (table: TableInfo, database: string | null) => void;
    /**
     * Every database of this tab's connection, and the way to point the tab at
     * one of them -- the editor toolbar's pair, handed down for its reason: the
     * explorer is a sibling feature and the shell already holds both.
     */
    databases: string[];
    onSelectDatabase: (database: string) => void;
    /** Whether this pane's database list is showing, so `Ctrl+D` can open it. */
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
    /**
     * `Ctrl+R`, arriving as a counter for `openDiagramRequest`'s reason: asking
     * for a fresh read is an event, and a boolean has no "off" for the second
     * press to come back from. It is summed with this component's own button
     * rather than watched by an effect -- both only ever count up, so the sum
     * changes exactly when either one is pressed, and there is nothing to keep
     * in step.
     */
    refreshRequest: number;
}

/**
 * Every table of a database, laid out with its columns and its keys, joined by
 * a line per foreign key.
 *
 * **It is a tab, and the tab is what says which database.** `Tab.database` is
 * the only thing that decides what is drawn — the same field `runQuery` and
 * `browseTable` read, one level up from a table. That is what makes two
 * diagrams on two databases two ordinary tabs rather than a view with a mode.
 *
 * **The arrangement is deliberately not remembered.** `layoutDiagram` runs from
 * the catalog every time this mounts, and dragging a node is an offset held
 * here that goes with it. A remembered arrangement would have to survive a
 * table being added, renamed or dropped, and a diagram that reopens with a node
 * pinned where a table no longer is is worse than one that arranges itself.
 */
export default function RelationshipDiagram({
    tab,
    onOpenTable,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
    refreshRequest,
}: Props) {
    const database = tab.database;
    const { bindings } = useShortcuts();
    // Every ask for a fresh read, from either way in. See `refreshRequest`.
    const [buttonReloads, setButtonReloads] = useState(0);
    const { tables, defaultSchema, loading, firstLoad, error } = useDiagram(
        database,
        buttonReloads + refreshRequest,
    );
    const canvas = useDiagramCanvas({
        tables,
        defaultSchema,
        firstLoad,
        error,
        onOpenTable,
        database,
    });

    return (
        <DiagramView
            database={database}
            databases={databases}
            onSelectDatabase={onSelectDatabase}
            pickerOpen={pickerOpen}
            onPickerOpenChange={onPickerOpenChange}
            loading={loading}
            firstLoad={firstLoad}
            error={error}
            canvas={canvas}
            onRefresh={() => setButtonReloads((asked) => asked + 1)}
            refreshChord={formatChord(bindings.refresh)}
        />
    );
}
