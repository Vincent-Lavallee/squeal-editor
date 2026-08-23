/**
 * Monaco's own shortcuts. `command` is the action id, `when` is the context
 * expression Monaco's own binding carries -- kept verbatim so a rebound chord
 * is scoped exactly as its default was, rather than firing wherever the
 * editor happens to own the keyboard. See `shortcutList.ts` for the combined
 * list and `shortcuts.ts` for the chord parsing this is read through.
 */
export const EDITOR_COMMAND_LIST = [
    {
        id: 'toggleComment',
        group: 'Text editing',
        label: 'Toggle line comment',
        defaultChord: 'Ctrl+/',
        command: 'editor.action.commentLine',
        when: 'editorTextFocus',
    },
    {
        id: 'toggleBlockComment',
        group: 'Text editing',
        label: 'Toggle block comment',
        defaultChord: 'Shift+Alt+A',
        command: 'editor.action.blockComment',
        when: 'editorTextFocus',
    },
    {
        id: 'formatDocument',
        group: 'Text editing',
        label: 'Format',
        defaultChord: 'Shift+Alt+F',
        command: 'editor.action.formatDocument',
        when: 'editorTextFocus',
    },
    {
        id: 'indentLines',
        group: 'Text editing',
        label: 'Indent',
        defaultChord: 'Ctrl+]',
        command: 'editor.action.indentLines',
        when: 'editorTextFocus',
    },
    {
        id: 'outdentLines',
        group: 'Text editing',
        label: 'Outdent',
        defaultChord: 'Ctrl+[',
        command: 'editor.action.outdentLines',
        when: 'editorTextFocus',
    },
    {
        id: 'moveLineUp',
        group: 'Text editing',
        label: 'Move line up',
        defaultChord: 'Alt+ArrowUp',
        command: 'editor.action.moveLinesUpAction',
        when: 'editorTextFocus',
    },
    {
        id: 'moveLineDown',
        group: 'Text editing',
        label: 'Move line down',
        defaultChord: 'Alt+ArrowDown',
        command: 'editor.action.moveLinesDownAction',
        when: 'editorTextFocus',
    },
    {
        id: 'copyLineUp',
        group: 'Text editing',
        label: 'Copy line up',
        defaultChord: 'Shift+Alt+ArrowUp',
        command: 'editor.action.copyLinesUpAction',
        when: 'editorTextFocus',
    },
    {
        id: 'copyLineDown',
        group: 'Text editing',
        label: 'Copy line down',
        defaultChord: 'Shift+Alt+ArrowDown',
        command: 'editor.action.copyLinesDownAction',
        when: 'editorTextFocus',
    },
    {
        id: 'deleteLine',
        group: 'Text editing',
        label: 'Delete line',
        defaultChord: 'Ctrl+Shift+K',
        command: 'editor.action.deleteLines',
        when: 'textInputFocus',
    },
    {
        id: 'triggerSuggest',
        group: 'Text editing',
        label: 'Trigger suggestion',
        defaultChord: 'Ctrl+Space',
        command: 'editor.action.triggerSuggest',
        when: 'textInputFocus',
    },

    // `when: null` is Monaco's own for these two -- Find and Replace open from
    // anywhere the editor's keyboard reaches, including the find widget itself.
    {
        id: 'find',
        group: 'Find',
        label: 'Find',
        defaultChord: 'Ctrl+F',
        command: 'actions.find',
        when: null,
    },
    {
        id: 'replace',
        group: 'Find',
        label: 'Replace',
        defaultChord: 'Ctrl+H',
        command: 'editor.action.startFindReplaceAction',
        when: null,
    },
    {
        id: 'findNext',
        group: 'Find',
        label: 'Find next',
        defaultChord: 'F3',
        command: 'editor.action.nextMatchFindAction',
        when: 'editorFocus',
    },
    {
        id: 'findPrevious',
        group: 'Find',
        label: 'Find previous',
        defaultChord: 'Shift+F3',
        command: 'editor.action.previousMatchFindAction',
        when: 'editorFocus',
    },
    {
        id: 'goToLine',
        group: 'Find',
        label: 'Go to line',
        defaultChord: 'Ctrl+G',
        command: 'editor.action.gotoLine',
        when: 'editorFocus',
    },
    {
        id: 'commandPalette',
        group: 'Find',
        label: "The editor's command palette",
        defaultChord: 'F1',
        command: 'editor.action.quickCommand',
        when: 'editorFocus',
    },

    {
        id: 'addCursorAbove',
        group: 'Selection',
        label: 'Add cursor above',
        defaultChord: 'Ctrl+Alt+ArrowUp',
        command: 'editor.action.insertCursorAbove',
        when: 'editorTextFocus',
    },
    {
        id: 'addCursorBelow',
        group: 'Selection',
        label: 'Add cursor below',
        defaultChord: 'Ctrl+Alt+ArrowDown',
        command: 'editor.action.insertCursorBelow',
        when: 'editorTextFocus',
    },
    // The one row shipping on a chord Monaco did not choose, which is what
    // `monacoChord` is for: Ctrl+D is the database picker now, so Monaco's own
    // binding is taken away at launch rather than only when a user moves it.
    {
        id: 'addSelectionToNextMatch',
        group: 'Selection',
        label: 'Add selection to next match',
        defaultChord: 'Ctrl+Shift+D',
        monacoChord: 'Ctrl+D',
        command: 'editor.action.addSelectionToNextFindMatch',
        when: 'editorFocus',
    },
    {
        id: 'selectAllOccurrences',
        group: 'Selection',
        label: 'Select all occurrences',
        defaultChord: 'Ctrl+Shift+L',
        command: 'editor.action.selectHighlights',
        when: 'editorFocus',
    },
] as const;
