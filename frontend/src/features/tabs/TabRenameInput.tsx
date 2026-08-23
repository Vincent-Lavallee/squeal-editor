import * as t from '../../common/tokens';

export default function TabRenameInput({
    inputRef,
    draft,
    onChange,
    onCommit,
    onCancel,
}: {
    inputRef: React.RefObject<HTMLInputElement>;
    draft: string;
    onChange: (value: string) => void;
    onCommit: () => void;
    onCancel: () => void;
}) {
    return (
        // A sibling of the button, not a child of it: an `<input>` is
        // interactive content and a `<button>` may not nest one, and
        // nesting it anyway risks the button's own mousedown behaviour
        // stealing focus back from it the instant it appears.
        <input
            data-testid="tab-rename-input"
            ref={inputRef}
            // A tab's name is a label, not prose: macOS otherwise offers
            // autofill, spelling and its own text substitutions over a
            // 200px-wide strip, each of them a native popup drawn outside
            // the webview and over the tabs beside it.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onCommit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            }}
            style={{
                flex: 1,
                minWidth: 0,
                height: t.TAB_H,
                margin: `0 ${t.GAP_XS}px 0 10px`,
                padding: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'inherit',
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                caretColor: t.ACCENT,
            }}
        />
    );
}
