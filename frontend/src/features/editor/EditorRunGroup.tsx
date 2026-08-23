import Button from '../../common/components/Button.tsx';
import Select from '../../common/components/Select.tsx';
import { formatChord, type Bindings } from '../../common/shortcuts.ts';
import * as t from '../../common/tokens';

/*
 * Run, and the caret that says where it runs.
 *
 * The group carries the accent fill and the rounded ends; the two halves inside
 * it draw neither, so there is one shape rather than two buttons that happen to
 * touch. The divider between them is a 1px rule in the accent's own foreground
 * at low alpha -- the design system's "structure from borders" applied inside a
 * filled control, where a `--border` grey would read as a gap.
 *
 * The caret is the whole of the attached half: the database's *name* is the
 * label at the left of the toolbar, not white text on the fill. Spelling it out
 * here put a second piece of high-contrast content inside the loudest control
 * on screen, which is what made the button shout. The arrow says "there is a
 * list behind this"; the label says which one is chosen.
 */
const runGroup: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'stretch',
    height: t.BUTTON_H_BAR,
    borderRadius: t.RADIUS,
    background: t.ACCENT,
    color: t.ON_ACCENT,
    overflow: 'hidden',
};

const runHalf: React.CSSProperties = {
    height: '100%',
    border: 'none',
    borderRadius: 0,
    background: 'none',
    color: 'inherit',
};

const runDivider: React.CSSProperties = {
    flex: 'none',
    width: 1,
    background: 'color-mix(in srgb, currentColor 35%, transparent)',
};

const barButton: React.CSSProperties = {
    height: t.BUTTON_H_BAR,
};

export default function EditorRunGroup({
    bindings,
    running,
    hasSelection,
    onRun,
    database,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: {
    bindings: Bindings;
    running: boolean;
    hasSelection: boolean;
    onRun: () => void;
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
}) {
    return (
        <div style={runGroup} data-testid="run-group">
            <Button
                style={{ ...barButton, ...runHalf }}
                data-testid="run-btn"
                variant="primary"
                title={formatChord(bindings.run)}
                onClick={onRun}
                disabled={running}
            >
                {running ? 'Running…' : hasSelection ? 'Run selection' : 'Run'}
            </Button>
            <div style={runDivider} aria-hidden="true" />
            {/* `align="end"`: the caret sits at the pane's right edge, so a
                left-aligned list would grow away from the pane it belongs to --
                and in a split it unfurls across the other one. */}
            <Select
                variant="attached"
                caretOnly
                searchable
                align="end"
                value={database ?? ''}
                onSelect={onSelectDatabase}
                open={pickerOpen}
                onOpenChange={onPickerOpenChange}
                options={databases.map((db) => ({ value: db, label: db }))}
                disabled={databases.length === 0}
                aria-label="Database this tab runs against"
                data-testid="editor-db-select"
                title={`${database ? `Runs against ${database}` : 'Pick a database'} (${formatChord(bindings.selectDatabase)})`}
                style={{ padding: `0 ${t.GAP_XS}px` }}
            />
        </div>
    );
}
