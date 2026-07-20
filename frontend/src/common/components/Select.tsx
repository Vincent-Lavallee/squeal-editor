import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { SelectCaretIcon } from '../icons/icons.ts';
import * as t from '../tokens';

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
  variant?: 'default' | 'bare';
  /** Lets the trigger be typed into to filter the list. Earn it: see above. */
  searchable?: boolean;
  /** Drawn when `value` names no option — the unchosen state. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
}

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
  borderColor: 'transparent',
};

const popupStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  padding: t.GAP_XS,
  border: `1px solid ${t.BORDER_STRONG}`,
  borderRadius: t.RADIUS,
  background: t.BG,
};

const optionBase: CSSProperties = {
  flex: 'none',
  padding: '5px 8px',
  border: 'none',
  borderRadius: t.RADIUS,
  background: 'none',
  color: t.TEXT,
  font: 'inherit',
  fontSize: t.TEXT_BODY,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  cursor: 'pointer',
};

/*
 * The search box *is* the trigger's label slot: same font, same weight, no box
 * of its own. It has to be indistinguishable from the text it replaces, or
 * opening the list would visibly swap one control for another under the cursor.
 */
const searchStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: 'none',
  background: 'none',
  color: t.TEXT,
  font: 'inherit',
  outline: 'none',
};

/** How long a typeahead buffer survives between keystrokes, as a native select does. */
const TYPEAHEAD_MS = 700;

export default function Select({
  options,
  value,
  onSelect,
  variant = 'default',
  searchable = false,
  placeholder,
  disabled,
  id,
  title,
  style,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: Props) {
  const trigger = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ buffer: '', at: 0 });

  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 });

  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  }, []);

  const choose = useCallback(
    (option: SelectOption) => {
      if (option.disabled) return;
      onSelect(option.value);
      close();
    },
    [onSelect, close]
  );

  /*
   * The popup is `position: fixed` and measured off the trigger rather than
   * being a child of it, because callers put this inside bars and scrolling
   * panes -- an absolutely positioned child would be clipped by the first
   * ancestor with `overflow: auto`. Same call `ContextMenu` makes, including
   * the clamp: a picker near the bottom of the window opens upward instead of
   * off the screen.
   */
  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const el = popup.current;
    if (!anchor || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const below = anchor.bottom + 2;
    const fitsBelow = below + height <= window.innerHeight - 4;
    setPos({
      top: fitsBelow ? below : Math.max(4, anchor.top - height - 2),
      left: Math.max(4, Math.min(anchor.left, window.innerWidth - width - 4)),
      minWidth: anchor.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, shown.length, place]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      const target = e.target as Node;
      if (popup.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    }
    /*
     * A scroll anywhere behind the popup moves the trigger out from under it, so
     * it closes -- but the listbox's *own* scrolling is not that. This listener
     * is on the capture phase, so without the guard, keeping the active row in
     * view scrolls the list, which fires a scroll, which shuts the popup: it
     * would close on the very first arrow key, and on opening at a value far
     * enough down the list to need scrolling to at all.
     */
    function onScroll(e: Event): void {
      if (popup.current?.contains(e.target as Node)) return;
      setOpen(false);
      setQuery('');
    }
    /*
     * A resize re-measures rather than closing. Closing is the obvious reach and
     * it is wrong twice over: the trigger is still right there, so there is
     * nothing for the user to be protected from -- and the app resizes itself at
     * startup, twice, to keep Aero Snap and to make the webview refit its frame
     * (see `useWindowChrome`). A picker opened while that is still settling was
     * being shut by the app's own window management, which reads as a click that
     * did nothing and reproduces only sometimes.
     */
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  /*
   * Keep the active row in view by scrolling *the listbox*, never
   * `scrollIntoView`: that walks every scrollable ancestor, so on a form long
   * enough to scroll it moves the page under a popup that is `position: fixed`
   * and does not follow -- and the scroll it causes is one the dismissal above
   * then has to be taught to ignore anyway.
   */
  useLayoutEffect(() => {
    const box = list.current;
    const row = box?.children[active];
    if (!box || !(row instanceof HTMLElement)) return;
    const bottom = row.offsetTop + row.offsetHeight;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [active, open]);

  // Opening lands on the current value, so arrowing starts from where you are
  // rather than from the top of the list.
  useEffect(() => {
    if (!open) return;
    const at = shown.findIndex((o) => o.value === value);
    setActive(at === -1 ? 0 : at);
    if (searchable) search.current?.focus();
  }, [open, searchable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtering moves the list under the cursor; keeping a stale index would
  // highlight a row that is no longer there, or none at all.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const step = (delta: number): void => {
    if (shown.length === 0) return;
    setActive((prev) => {
      let next = prev;
      // Skip disabled rows rather than landing on one, the way a native list
      // does. Bounded by the list length so an all-disabled list cannot spin.
      for (let i = 0; i < shown.length; i++) {
        next = (next + delta + shown.length) % shown.length;
        if (!shown[next]?.disabled) return next;
      }
      return prev;
    });
  };

  /*
   * Typeahead, for the lists that cannot be searched. On a searchable one the
   * letters belong in the trigger's own box: typing `u` to mean "narrow to
   * users" and having it also jump the highlight is two answers to one
   * keystroke.
   */
  const typeahead = (key: string): boolean => {
    if (key.length !== 1 || searchable) return false;
    const now = Date.now();
    const buffer = now - typed.current.at > TYPEAHEAD_MS ? key : typed.current.buffer + key;
    typed.current = { buffer, at: now };
    const at = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(buffer.toLowerCase()));
    if (at === -1) return false;
    if (open) setActive(at);
    else onSelect(options[at]!.value);
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (typeahead(e.key)) e.preventDefault();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        step(-1);
        break;
      // Home/End jump the list, except while typing into the trigger, where
      // they are the caret's and moving the highlight would steal them.
      case 'Home':
        if (searchable) break;
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        if (searchable) break;
        e.preventDefault();
        setActive(Math.max(0, shown.length - 1));
        break;
      case 'Enter': {
        e.preventDefault();
        const option = shown[active];
        if (option) choose(option);
        break;
      }
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        setOpen(false);
        setQuery('');
        break;
      default:
        if (typeahead(e.key)) e.preventDefault();
    }
  };

  const isBare = variant === 'bare';
  const showsBox = focused || open || (hovered && !disabled);
  const searching = open && searchable && !disabled;

  return (
    <>
      <div
        ref={trigger}
        id={id}
        title={title}
        tabIndex={disabled ? -1 : 0}
        data-testid={testId}
        data-value={value}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled ? true : undefined}
        aria-label={ariaLabel}
        style={{
          ...(isBare ? bare : base),
          ...(disabled ? { color: t.TEXT_FAINT, borderColor: t.BORDER, cursor: 'default' } : {}),
          ...(focused && !isBare && !disabled ? { borderColor: t.ACCENT } : {}),
          ...(isBare && showsBox && !disabled ? { borderColor: t.BORDER_STRONG } : {}),
          ...(style ?? {}),
        }}
        // The input is a child, so its clicks bubble here; without the guard,
        // clicking into the text you are typing would toggle the list shut.
        onClick={(e) => {
          if (disabled || e.target === search.current) return;
          setOpen((prev) => !prev);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {searching ? (
          <input
            ref={search}
            data-testid={testId ? `${testId}-search` : undefined}
            style={searchStyle}
            value={query}
            // The value it is replacing, so the box reads as the same control
            // it was a moment ago rather than as an empty field.
            placeholder={selected?.label ?? placeholder ?? ''}
            aria-label={ariaLabel}
            aria-autocomplete="list"
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              ...(selected ? {} : { color: t.TEXT_FAINT }),
            }}
          >
            {selected?.label ?? placeholder ?? ''}
          </span>
        )}
        <SelectCaretIcon
          style={{ flex: 'none', width: t.ICON, height: t.ICON, color: disabled ? t.TEXT_FAINT : t.TEXT_MUTED }}
          aria-hidden="true"
        />
      </div>

      {open && (
        <div
          ref={popup}
          data-testid={testId ? `${testId}-popup` : undefined}
          style={{ ...popupStyle, top: pos.top, left: pos.left, minWidth: pos.minWidth, maxWidth: 360 }}
          onKeyDown={onKeyDown}
        >
          <div ref={list} role="listbox" aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' }}>
            {shown.length === 0 && (
              <div style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>No matches</div>
            )}
            {shown.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                data-value={option.value}
                style={{
                  ...optionBase,
                  ...(option.disabled ? { color: t.TEXT_FAINT, cursor: 'default' } : {}),
                  ...(index === active && !option.disabled ? { background: t.HOVER } : {}),
                  ...(option.value === value ? { background: t.SELECTED, color: t.ACCENT } : {}),
                }}
                onMouseEnter={() => !option.disabled && setActive(index)}
                onClick={() => choose(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
