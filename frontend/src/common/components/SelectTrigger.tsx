import type { CSSProperties } from 'react';
import * as t from '../tokens';
import SelectTriggerContent from './SelectTriggerContent.tsx';
import TriggerCaret from './TriggerCaret.tsx';
import type { useSelect } from './hooks/useSelect.ts';

const base: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_XS,
    width: '100%',
    height: 32,
    padding: '0 6px 0 9px',
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BODY,
    textAlign: 'left',
    outline: 'none',
    cursor: 'pointer',
};

// A bare select is a chrome control, not a form field: it reads as the label of
// the thing it names until you reach for it. The box it grows is grayscale
// because having focus is not a state worth spending the accent on.
//
// It is shorter than an input because it sits inside a bar rather than in a
// form. At the input's 32px it fills a 32px strip edge to edge and its box
// collides with the strip's own bottom rule.
const bare: CSSProperties = {
    ...base,
    height: 24,
    padding: '0 2px 0 6px',
    fontWeight: 600,
    fontSize: t.TEXT_BADGE,
    borderColor: 'transparent',
};

// Nothing of its own: no box, no fill, no width, and -- the part that matters --
// no colour either. `inherit` is what makes the caret exactly the host's
// foreground, so the arrow on an accent-filled button is the same white as the
// label beside it rather than `--text` sitting on top of the fill.
const attached: CSSProperties = {
    ...base,
    width: 'auto',
    height: '100%',
    padding: `0 ${t.GAP_XS}px 0 ${t.GAP_SM}px`,
    border: 'none',
    borderRadius: 0,
    background: 'none',
    color: 'inherit',
    fontSize: t.TEXT_BADGE,
    fontWeight: 600,
};

type SelectState = ReturnType<typeof useSelect>;

export type TriggerProps = {
    select: SelectState;
    id: string | undefined;
    title: string | undefined;
    testId: string | undefined;
    value: string;
    disabled: boolean | undefined;
    ariaLabel: string | undefined;
    variant: 'default' | 'bare' | 'attached';
    style: CSSProperties | undefined;
    caretOnly: boolean;
    placeholder: string | undefined;
};

function triggerStyle(options: {
    variant: 'default' | 'bare' | 'attached';
    disabled: boolean | undefined;
    focused: boolean;
    showsBox: boolean;
    style: CSSProperties | undefined;
}): CSSProperties {
    const { variant, disabled, focused, showsBox, style } = options;
    const isBare = variant === 'bare';
    const isAttached = variant === 'attached';
    return {
        ...(isAttached ? attached : isBare ? bare : base),
        ...(disabled ? { color: t.TEXT_FAINT, borderColor: t.BORDER, cursor: 'default' } : {}),
        ...(focused && !isBare && !isAttached && !disabled ? { borderColor: t.ACCENT } : {}),
        ...(isBare && showsBox && !disabled ? { borderColor: t.BORDER_STRONG } : {}),
        ...(style ?? {}),
    };
}

export default function SelectTrigger({
    select,
    id,
    title,
    testId,
    value,
    disabled,
    ariaLabel,
    variant,
    style,
    caretOnly,
    placeholder,
}: TriggerProps) {
    const isAttached = variant === 'attached';

    return (
        <div
            ref={select.position.trigger}
            id={id}
            title={title}
            tabIndex={disabled ? -1 : 0}
            data-testid={testId}
            data-value={value}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={select.open}
            aria-disabled={disabled ? true : undefined}
            aria-label={ariaLabel}
            style={triggerStyle({
                variant,
                disabled,
                focused: select.focused,
                showsBox: select.showsBox,
                style,
            })}
            // The input is a child, so its clicks bubble here; without the guard,
            // clicking into the text you are typing would toggle the list shut.
            onClick={(e) => {
                if (disabled || e.target === select.search.current) return;
                select.setOpen((prev) => !prev);
            }}
            onKeyDown={select.nav.onKeyDown}
            onFocus={() => select.setFocused(true)}
            onBlur={() => select.setFocused(false)}
            onMouseEnter={() => select.setHovered(true)}
            onMouseLeave={() => select.setHovered(false)}
        >
            <SelectTriggerContent
                select={select}
                caretOnly={caretOnly}
                testId={testId}
                placeholder={placeholder}
                ariaLabel={ariaLabel}
            />
            <TriggerCaret disabled={disabled} isAttached={isAttached} />
        </div>
    );
}
