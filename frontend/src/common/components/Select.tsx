import type { CSSProperties } from 'react';

import SelectPopup from './SelectPopup.tsx';
import SelectTrigger from './SelectTrigger.tsx';
import { useSelect } from './useSelect.ts';

/**
 * The app's one dropdown: a trigger naming the current value, and a floating
 * listbox of the choices.
 *
 * It is hand-rolled rather than a native `<select>` for exactly one reason —
 * the database picker has to be searchable, and a native select's popup is
 * browser DOM that cannot hold a field. Nothing else about it is meant to
 * change, so the trigger is the same box at the same two heights and the popup
 * follows the floating rule the menus already set: `--bg`, a 1px
 * `--border-strong` outline, never a shadow.
 *
 * What a native select gave away for free had to be rebuilt, and the list is
 * the whole reason this component is worth having rather than three listboxes:
 * arrow keys, Home/End, Enter/Escape, dismissal on an outside click or a
 * scroll, and the type-a-few-letters-to-jump behaviour that is invisible until
 * a keyboard user reaches for it. Search is opt-in per usage — a search box
 * over four fixed options is noise, so only the database picker asks for one.
 *
 * **Searching happens in the trigger, not in a field above the list.** The
 * trigger already shows the current value and is already where you clicked, so
 * a second box under it is a second place to look for one answer — and it costs
 * the popup a row of height on every open, searched or not. That is why the
 * trigger is a focusable `<div>` and not a `<button>`: it holds an `<input>`
 * while the list is open, and a `<button>` may not contain one. Same reason the
 * tab strip is a row of two buttons rather than one.
 *
 * Options are data, not children, the same call `ContextMenu` makes: every
 * caller writes its own labels and disabled rules and none of them
 * re-implements the chrome.
 *
 * Split into `SelectTrigger`/`SelectPopup`/`SelectOptionRow` for the render
 * tree and `useSelect` (composing `useSelectOpenState`,
 * `useSelectPopupPosition`, `useSelectKeyboardNav`) for the behaviour; this
 * component wires them together and owns nothing else.
 */
export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

interface Props {
    options: readonly SelectOption[];
    value: string;
    onSelect: (value: string) => void;
    /**
     * `attached` is a trigger with no chrome of its own, for sitting *inside*
     * another control -- the database segment fused onto the Run button. It draws
     * no border, no background and no width of its own, and its caret inherits
     * `color` rather than taking the muted grey the standalone variants use,
     * because on an accent-filled button that grey is unreadable. Everything the
     * caller wants it to look like arrives through `style`.
     */
    variant?: 'default' | 'bare' | 'attached';
    /** Lets the trigger be typed into to filter the list. Earn it: see above. */
    searchable?: boolean;
    /**
     * A trigger that is **only** the caret: no value, no placeholder, just the
     * affordance saying a list is behind it. For a picker whose value is already
     * stated somewhere better -- the Run button's, where the database is spelled
     * out in the toolbar beside it and repeating it inside an accent fill was
     * exactly what made that control shout.
     *
     * `searchable` still works: the box moves **into the popup**, since a trigger
     * this narrow has nowhere to put one and nothing to show what was typed.
     */
    caretOnly?: boolean;
    /**
     * Which edge of the trigger the popup lines up with. `start` (the default) is
     * the left, which is right for a trigger at the left of what it belongs to.
     *
     * `end` right-aligns it, so the list opens *leftward*. That is what a trigger
     * near the right edge of its pane needs: left-aligned, the popup grows away
     * from the pane it belongs to and, in a split, unfurls across the other one.
     */
    align?: 'start' | 'end';
    /**
     * Controlled open state, for a picker something *other* than its own trigger
     * can open -- the keyboard shortcut. Omitted, the component owns it, which is
     * every other usage.
     *
     * Both halves or neither: a caller that passes `open` must also handle
     * `onOpenChange`, or the popup can never be dismissed by clicking away.
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Drawn when `value` names no option — the unchosen state. */
    placeholder?: string;
    disabled?: boolean;
    id?: string;
    title?: string;
    style?: CSSProperties;
    'aria-label'?: string;
    'data-testid'?: string;
}

export default function Select({
    options,
    value,
    onSelect,
    variant = 'default',
    searchable = false,
    caretOnly = false,
    align = 'start',
    open: openProp,
    onOpenChange,
    placeholder,
    disabled,
    id,
    title,
    style,
    'aria-label': ariaLabel,
    'data-testid': testId,
}: Props) {
    const s = useSelect({
        options,
        value,
        onSelect,
        variant,
        searchable,
        caretOnly,
        align,
        openProp,
        onOpenChange,
        disabled,
    });

    return (
        <>
            <SelectTrigger
                select={s}
                id={id}
                title={title}
                testId={testId}
                value={value}
                disabled={disabled}
                ariaLabel={ariaLabel}
                variant={variant}
                style={style}
                caretOnly={caretOnly}
                placeholder={placeholder}
            />

            {s.open && (
                <SelectPopup
                    select={s}
                    testId={testId}
                    ariaLabel={ariaLabel}
                    placeholder={placeholder}
                    value={value}
                />
            )}
        </>
    );
}
