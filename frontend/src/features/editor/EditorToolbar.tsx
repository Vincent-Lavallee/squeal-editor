import Button from '../../common/components/Button.tsx';
import { formatChord, type Bindings } from '../../common/shortcuts.ts';
import * as t from '../../common/tokens';
import EditorRunGroup from './EditorRunGroup.tsx';

const toolbar: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    padding: `0 ${t.GAP_SM}px`,
    borderBottom: `1px solid ${t.BORDER}`,
};

const barButton: React.CSSProperties = {
    height: t.BUTTON_H_BAR,
};

const spacer: React.CSSProperties = {
    flex: 1,
};

/*
 * The database this tab runs against, said quietly at the far left of the bar.
 *
 * 11px and muted because it is a *label*, read at a glance and rarely acted on
 * -- the accent-filled Run button already carries all the weight this bar can
 * afford, and a second thing competing with it is what spelling the database
 * out inside that button turned into. It is not uppercased or letter-spaced the
 * way `TEXT_LABEL` usually is: this is a name the server gave us, and casing
 * anything the server said is the one thing the value rules forbid.
 */
const databaseLabel: React.CSSProperties = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: t.TEXT_MUTED,
    fontSize: t.TEXT_LABEL,
};

export default function EditorToolbar({
    database,
    bindings,
    format,
    running,
    hasSelection,
    onRun,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: {
    database: string | null;
    bindings: Bindings;
    format: () => void;
    running: boolean;
    hasSelection: boolean;
    onRun: () => void;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
}) {
    return (
        <div className="toolbar" style={toolbar}>
            {database && (
                <span
                    data-testid="editor-db-label"
                    style={databaseLabel}
                    title={`This tab runs against ${database} (${formatChord(bindings.selectDatabase)} to change it)`}
                >
                    {database}
                </span>
            )}
            <div style={spacer} />
            <Button style={barButton} onClick={format}>
                Format
            </Button>

            <EditorRunGroup
                bindings={bindings}
                running={running}
                hasSelection={hasSelection}
                onRun={onRun}
                database={database}
                databases={databases}
                onSelectDatabase={onSelectDatabase}
                pickerOpen={pickerOpen}
                onPickerOpenChange={onPickerOpenChange}
            />
        </div>
    );
}
