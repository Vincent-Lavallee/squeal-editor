import { useRef } from 'react';
import type { ShortcutId } from '../../../common/shortcuts.ts';
import type { SqlDialect } from '../../../../../shared/protocol/index.ts';

/**
 * The Ctrl+Enter command (and its siblings) are registered once, with the
 * editor, but have to run whatever the *current* handler, text and tab are --
 * capturing them would pin the action to the first render and run the empty
 * query forever. This ref is what every Monaco-registered callback reads
 * instead of closing over props directly.
 */
export function useLatestEditorState(state: {
    sql: string;
    onRun: (sql: string) => void;
    dialect: SqlDialect;
    activeTabId: string | null;
    peekSql: (tabId: string) => string | undefined;
    commands: Partial<Record<ShortcutId, () => void>> | undefined;
    onSaveQuery: (() => void) | undefined;
    onExplainSelection: ((sql: string) => void) | undefined;
}) {
    const latest = useRef(state);
    latest.current = state;
    return latest;
}
