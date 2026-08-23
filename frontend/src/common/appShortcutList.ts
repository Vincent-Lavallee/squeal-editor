/**
 * The rows something in *this app* answers -- `Shell` or `EditorPane`, never
 * Monaco. See `shortcutList.ts` for the combined list and `shortcuts.ts` for
 * the chord parsing this is read through.
 */
export const APP_SHORTCUT_LIST = [
    { id: 'run', group: 'Editor', label: 'Run', defaultChord: 'Ctrl+Enter' },
    {
        id: 'runStatement',
        group: 'Editor',
        label: 'Run statement under cursor',
        defaultChord: 'Ctrl+Shift+Enter',
    },
    { id: 'saveQuery', group: 'Editor', label: 'Save query', defaultChord: 'Ctrl+S' },
    // It acts on the pane being worked in, so a split answers for the half you
    // are in rather than always for the primary one. Ctrl+D was Monaco's "add
    // selection to next find match" and is now this: that action is a row below,
    // moved to Ctrl+Shift+D. See `docs/decisions.md`.
    {
        id: 'selectDatabase',
        group: 'Editor',
        label: "Switch this tab's database",
        defaultChord: 'Ctrl+D',
    },
    // A grid tab's, and only a grid tab's: it re-reads the page on screen, where
    // an editor tab's Ctrl+R could only mean re-running whatever statements it
    // holds -- which is Run's to ask for, and would re-issue an INSERT for a key
    // every browser has taught the user means "reload". The webview's own reload
    // is exactly why it is bound at all: the listeners preventDefault it whether
    // or not there is anything to refresh, on every kind of tab.
    { id: 'refresh', group: 'Results', label: 'Refresh the rows', defaultChord: 'Ctrl+R' },
    { id: 'newTab', group: 'Tabs', label: 'New tab', defaultChord: 'Ctrl+T' },
    // The Shift-pair of New tab, and the one command that says "split" out loud
    // by minting rather than moving -- `dockTab` below is still the only way an
    // existing tab crosses. See `docs/frontend.md`.
    {
        id: 'newTabOtherPane',
        group: 'Tabs',
        label: 'New tab in the other pane',
        defaultChord: 'Ctrl+Shift+T',
    },
    { id: 'closeTab', group: 'Tabs', label: 'Close tab', defaultChord: 'Ctrl+W' },
    { id: 'nextTab', group: 'Tabs', label: 'Next tab', defaultChord: 'Ctrl+PageDown' },
    { id: 'previousTab', group: 'Tabs', label: 'Previous tab', defaultChord: 'Ctrl+PageUp' },
    // "Split" is what this looks like, never what it is called: the app has no
    // split verb -- a split is a tab being in the pane that had none, which is
    // exactly what moving one there does. See `docs/frontend.md`.
    { id: 'dockTab', group: 'Tabs', label: 'Move tab to the other pane', defaultChord: 'Ctrl+\\' },
    // No confirmation, unlike closing a tab: `disconnect.pending` saves the
    // session while the tabs still exist, so a disconnect parks work rather than
    // destroying it. See `docs/decisions.md`.
    { id: 'disconnect', group: 'Connection', label: 'Disconnect', defaultChord: 'Ctrl+Shift+W' },
    { id: 'toggleSidebar', group: 'View', label: 'Toggle sidebar', defaultChord: 'Ctrl+B' },
    // The Shift-pair of Toggle sidebar, because it is the other thing you do to
    // the tree as a whole rather than to a row in it. Ctrl+Shift+S would have been
    // the mnemonic and is the webview's own "save page as".
    {
        id: 'syncTree',
        group: 'View',
        label: "Keep the tree on the tab's database",
        defaultChord: 'Ctrl+Shift+B',
    },
    // Reveals the sidebar first if it is folded away, since a field nobody can
    // see is not one focus can be put into.
    // The `id` keeps its old spelling on purpose: it is the key a rebound chord is
    // stored under, and renaming it would silently drop every override already saved.
    { id: 'filterTables', group: 'View', label: 'Search tables', defaultChord: 'Ctrl+Shift+F' },
    {
        id: 'newAssistantChat',
        group: 'View',
        label: 'New assistant chat',
        defaultChord: 'Ctrl+Shift+A',
    },
] as const;
