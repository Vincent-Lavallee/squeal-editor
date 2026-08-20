import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AssistantIcon, CloseIcon, DiagramIcon, NewTabIcon, QueryIcon, TableIcon } from '../../common/icons/icons.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

/**
 * The drag payload's MIME type, and it is deliberately not `text/plain`.
 *
 * Nothing ever reads this back -- the dragged id travels as React state, which
 * is what lets the UI suite drive a drag with plain `MouseEvent`s carrying no
 * `dataTransfer` at all. Something still has to be set for the browser to
 * start a drag, and the type it is set *under* turns out to matter: Monaco
 * accepts a `text/plain` drop and inserts it, so dragging a tab across the
 * editor pasted the tab's id into the query. A type nothing else claims means
 * every text surface in the app -- Monaco, every `<input>` -- has nothing to
 * take from it.
 */
const DRAG_TYPE = 'application/x-squeal-tab';

/**
 * How close to the strip's edge a drag has to reach before it scrolls, and how
 * far each `dragover` moves it. The strip is only 32px tall, so the band is
 * generous: the pointer is aiming at a gap between tabs, not at the edge.
 */
const AUTOSCROLL_EDGE = 56;
const AUTOSCROLL_STEP = 18;

/**
 * Where a dragged tab would land: in front of a tab, or at the end (`null`).
 * `undefined` is the third state and not a sloppy one -- it is "the drag has not
 * been over anything yet", which `null` is already spoken for and cannot say.
 */
type DropAt = string | null | undefined;

interface Props {
  /**
   * Which tabs this strip draws, and which one is active among them -- a prop
   * rather than read off `useTabs()` internally, because a split view mounts
   * two of these at once, one per pane, and each needs its own subset. See
   * *Split the editor* in `docs/frontend.md`.
   */
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToTheRight: (id: string) => void;
  onCloseAll: () => void;
  /** Drop `id` in front of `beforeId`, or at the end when that is null. */
  onMove: (id: string, beforeId: string | null) => void;
  onRename: (id: string, title: string) => void;
  /** Omitted on the secondary pane's strip -- new tabs only ever open primary. */
  onNewTab?: () => void;
  /**
   * Duplicating copies the query text, which lives in the editor's context and
   * not in the tab -- so it is wired in the composition root like every other
   * thing that spans two features, and arrives here as a prop. Omitted on the
   * secondary pane's strip for the same reason `onNewTab` is.
   */
  onDuplicateTab?: (tabId: string) => void;
  /**
   * Save an editor tab's text as a named query -- the menu's route to what
   * Ctrl+S does. The text is the editor's, not the tab's, so like duplicate it
   * is wired in the composition root and arrives here as a prop. It takes an id
   * rather than acting on the active tab, because the menu can be summoned on a
   * tab that is not in front.
   */
  onSaveTab?: (tabId: string) => void;
  /**
   * The id of whatever tab is being dragged, from *either* strip -- a
   * controlled prop, not local state, because a drop has to be accepted by
   * the strip it lands on even when the drag started in the other one, and
   * only the composition root sees both. Set from this strip's own
   * `onDragStart`/`onDragEnd` via `onDragTab`, which is also what the
   * dock-to-split drop zone watches for. `null` when nothing is being dragged
   * anywhere.
   */
  draggingId: string | null;
  onDragTab: (id: string | null) => void;
}

export default function TabStrip({ tabs: tabList, activeTabId, onActivate, onClose, onCloseOthers, onCloseToTheRight, onCloseAll, onMove, onRename, onNewTab, onDuplicateTab, onSaveTab, draggingId, onDragTab }: Props) {
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [hoveredCloseId, setHoveredCloseId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropAt, setDropAt] = useState<DropAt>(undefined);
  // The draft while typing. Component state, not the store: `title` only earns a
  // dispatch on commit (blur/Enter), the same split the grid draws between an
  // in-progress cell edit and the value it saves.
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const commitRename = () => {
    if (renaming) onRename(renaming.id, renaming.draft);
    setRenaming(null);
  };
  // Focused and selected once, when rename mode is *entered* -- not an inline
  // ref callback, whose identity changes every render and which React
  // therefore re-invokes after every keystroke. Re-selecting on each of those
  // is what let only one character land at a time: the next keystroke replaced
  // the selection the previous one had just created.
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) { renameInputRef.current?.focus(); renameInputRef.current?.select(); }
  }, [renaming?.id]);

  const strip = useRef<HTMLDivElement>(null);

  /*
   * Bring a tab into view.
   *
   * The last tab is scrolled to the strip's very *end* rather than merely into
   * view: `scrollIntoView` stops as soon as the tab fits, which parks its right
   * edge against the strip's and leaves the `+` beyond it still off screen --
   * a strip that visibly stopped short of the end it was asked for.
   */
  const revealTab = (id: string) => {
    const el = strip.current;
    if (!el) return;
    if (tabList[tabList.length - 1]?.id === id) { el.scrollLeft = el.scrollWidth; return; }
    el.querySelector(`[data-tab-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  };

  /*
   * Follow a tab that has just moved.
   *
   * The move is the store's and this strip re-renders from it, so the scroll
   * cannot happen in the drop handler -- the tab is not yet where it is going.
   * A layout effect keyed on the id runs after that render and before the
   * paint, so the strip never shows the tab at its old position first. Cleared
   * once spent, or the next unrelated render would scroll again.
   */
  const [reveal, setReveal] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (reveal === null) return;
    revealTab(reveal);
    setReveal(null);
  }, [reveal]);

  /*
   * Follow the tab that is now in front.
   *
   * A tab arriving (`+`, a table, a definition, a duplicate, a saved query, a
   * tab docked from the other pane) is appended and made active, so on a strip
   * that already overflows it is born off screen -- the click opens something
   * nobody can see. The tab count is a dependency beside the id because a tab
   * can arrive without changing which one is active, and a *reorder* changes
   * neither, which is what `reveal` above is for.
   */
  useLayoutEffect(() => {
    if (activeTabId) revealTab(activeTabId);
  }, [activeTabId, tabList.length]);

  const endDrag = () => { setDropAt(undefined); onDragTab(null); };

  /*
   * A drag ended somewhere, and this strip's insertion mark has nothing left to
   * mean. `endDrag` alone does not cover it: a tab dragged into the *other*
   * pane leaves this strip's tab element unmounted, so the `dragend` that would
   * have cleared the mark never fires here and it stays drawn until the next
   * drag. Watching the id the composition root holds catches every ending,
   * including that one.
   */
  useEffect(() => { if (draggingId === null) setDropAt(undefined); }, [draggingId]);

  const drop = () => {
    if (draggingId && dropAt !== undefined) {
      onMove(draggingId, dropAt);
      // Follow it. A tab dropped past the right edge of a strip that scrolls
      // lands somewhere nobody can see, and the drag ends with the tab you
      // just moved apparently gone -- see `reveal` above.
      setReveal(draggingId);
    }
    endDrag();
  };

  /*
   * Scroll the strip while a tab is dragged near either end of it.
   *
   * Without this the strip only ever shows the tabs it was already showing, so
   * a strip with more tabs than fit cannot be dragged *into* the part that is
   * scrolled out of view -- the drop lands wherever happened to be under the
   * pointer instead. Hung off `dragover`, which fires repeatedly for as long as
   * the pointer is over the strip, so holding still at the edge keeps it
   * moving; there is no interval to start or to remember to clear.
   */
  const autoScroll = (e: React.DragEvent) => {
    const el = strip.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (e.clientX > box.right - AUTOSCROLL_EDGE) el.scrollLeft += AUTOSCROLL_STEP;
    else if (e.clientX < box.left + AUTOSCROLL_EDGE) el.scrollLeft -= AUTOSCROLL_STEP;
  };

  /*
   * Where a drop at `clientX` would land: in front of the first tab whose
   * midpoint the pointer has not reached, else at the end.
   *
   * Worked out from the strip and not from a `dragover` on each tab, because
   * the strip is more than its tabs -- the `+` and the empty space past the
   * last one belong to it too, and a per-tab handler leaves all of that
   * answering with whatever the last tab the pointer happened to cross said.
   * That is a mark pointing at a slot the drop is not aiming for, and a `drop`
   * that honours it.
   */
  const dropTargetAt = (clientX: number): DropAt => {
    const el = strip.current;
    if (!el) return undefined;
    for (const tabEl of el.querySelectorAll<HTMLElement>('[data-tab-id]')) {
      const box = tabEl.getBoundingClientRect();
      if (clientX < box.left + box.width / 2) return tabEl.dataset.tabId!;
    }
    return null;
  };

  const dragOverStrip = (e: React.DragEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    const next = dropTargetAt(e.clientX);
    setDropAt(next);
    /*
     * Landing at the very end means the mark that says so is drawn past the
     * last tab -- which, on a strip with more tabs than fit, is off screen.
     * Going all the way to the end is the only scroll position that shows it,
     * and it is what makes "drop it last" a thing you can see rather than
     * infer. The edge auto-scroll cannot serve this: it moves by a step per
     * event, so the mark arrives several events after the intent does.
     */
    if (next === null && strip.current) strip.current.scrollLeft = strip.current.scrollWidth;
    else autoScroll(e);
  };

  /*
   * The pointer left the strip, so the mark goes with it -- otherwise the strip
   * a tab was dragged *out* of keeps advertising a slot while the drop is being
   * aimed at the other pane. `dragleave` bubbles from every tab, so crossing
   * from one tab to its neighbour fires it here too; the coordinates, not the
   * event, are what say whether the pointer really left.
   */
  const dragLeaveStrip = (e: React.DragEvent) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box) return;
    const inside = e.clientX >= box.left && e.clientX < box.right && e.clientY >= box.top && e.clientY < box.bottom;
    if (!inside) setDropAt(undefined);
  };

  const menuItems = (id: string): MenuItem[] => {
    const index = tabList.findIndex((tab) => tab.id === id);
    const tab = tabList[index];
    const only = tabList.length === 1;
    const last = index === tabList.length - 1;
    const holdsText = tab?.kind === 'editor';
    return [
      // What this tab is, then what to do with it, then the closes. `Close`
      // heads that last group rather than the menu: the × is a hover target on
      // the tab itself, so a menu offering only "close others" read as there
      // being no way to close *this* one, and that is answered by the item
      // existing, not by it being first.
      { label: 'Rename', onSelect: () => setRenaming({ id, draft: tab?.title ?? '' }) },
      { label: 'Save', disabled: !holdsText || !onSaveTab, title: holdsText ? undefined : 'Only a query tab has text to save', onSelect: () => onSaveTab?.(id) },
      { label: 'Duplicate', disabled: !onDuplicateTab, onSelect: () => onDuplicateTab?.(id) },
      { label: 'Close', onSelect: () => onClose(id) },
      { label: 'Close others', disabled: only, onSelect: () => onCloseOthers(id) },
      { label: 'Close Tabs to the Right', disabled: last, onSelect: () => onCloseToTheRight(id) },
      { label: 'Close All', onSelect: () => onCloseAll() },
    ];
  };

  return (
    <div ref={strip} data-testid="tabs" style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0, borderBottom: `1px solid ${t.BORDER}`, overflowX: 'auto', scrollbarWidth: 'none' }} role="tablist"
      onDragOver={dragOverStrip} onDragLeave={dragLeaveStrip} onDrop={drop}>
      {tabList.map((tab, index) => {
        const active = tab.id === activeTabId;
        const hovered = hoveredTabId === tab.id;
        // The dot stands in for the close until the pointer is on the slot
        // itself; an unsaved tab's slot never hides, since the dot is a state
        // and not an action offered on hover.
        const showsDot = tab.unsaved === true && hoveredCloseId !== tab.id;
        const shown = active || hovered || tab.unsaved === true;
        const Icon =
          tab.kind === 'grid' ? TableIcon : tab.kind === 'diagram' ? DiagramIcon : tab.kind === 'assistant' ? AssistantIcon : QueryIcon;
        // Only while something is actually in flight, and never on the tab
        // being dragged: an insertion mark on the thing you are holding says a
        // move that is no move at all.
        const marked = draggingId !== null && dropAt !== undefined && dropAt !== draggingId;

        return (
          <div data-testid="tab" data-tab-id={tab.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', maxWidth: 200, paddingRight: t.GAP_XS, opacity: tab.id === draggingId ? 0.4 : 1, ...(active ? { background: t.SELECTED, color: t.ACCENT } : {}) }}
            key={tab.id} onMouseEnter={() => setHoveredTabId(tab.id)} onMouseLeave={() => setHoveredTabId(null)}
            // Not draggable mid-rename: a drag reads the tab id off this
            // element regardless of what is focused inside it, and a text
            // selection dragged from the input has no business moving the tab.
            draggable={renaming?.id !== tab.id}
            onDragStart={(e) => { onDragTab(tab.id); e.dataTransfer?.setData(DRAG_TYPE, tab.id); }} onDragEnd={endDrag}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ id: tab.id, x: e.clientX, y: e.clientY }); }}>

            {marked && dropAt === tab.id && <DropMark side="left" />}
            {marked && dropAt === null && index === tabList.length - 1 && <DropMark side="right" />}

            {renaming?.id === tab.id ? (
              // A sibling of the button, not a child of it: an `<input>` is
              // interactive content and a `<button>` may not nest one, and
              // nesting it anyway risks the button's own mousedown behaviour
              // stealing focus back from it the instant it appears.
              <input
                data-testid="tab-rename-input"
                ref={renameInputRef}
                value={renaming.draft}
                onChange={(e) => setRenaming({ id: tab.id, draft: e.target.value })}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                }}
                style={{ flex: 1, minWidth: 0, height: t.TAB_H, margin: `0 ${t.GAP_XS}px 0 10px`, padding: 0, border: 'none', outline: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: t.TEXT_BADGE, caretColor: t.ACCENT }}
              />
            ) : (
              <button data-testid="tab-pick" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 1, minWidth: 0, height: t.TAB_H, padding: `0 ${t.GAP_XS}px 0 10px`, border: 'none', background: 'none', color: 'inherit', font: 'inherit', fontSize: t.TEXT_BADGE, cursor: 'pointer' }}
                role="tab" aria-selected={active} onClick={() => onActivate(tab.id)} title={tab.title}>
                <Icon style={{ ...iconSvg, color: active ? 'inherit' : t.TEXT_MUTED }} aria-hidden="true" />
                <span data-testid="tab-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ id: tab.id, draft: tab.title }); }}>{tab.title}</span>
              </button>
            )}
            {/* One slot, two marks. An unsaved tab shows a dot where its close
                would be and swaps to the close on hover -- so the mark costs no
                width of its own beside the label, and the control it stands in
                for is one pointer-move away rather than gone.

                The swap is keyed on hovering *this button*, not the tab: at tab
                level the dot would vanish the moment the pointer touched the tab
                anywhere, which is most of the time you are looking at it.

                An unsaved tab's slot is always shown, active or not -- it is the
                only acknowledgement a silent Ctrl+S gives, so it may not be
                hidden behind a hover the way a plain close is. */}
            <button data-testid="tab-close" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 20, height: 20, padding: 0, border: 'none', borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer', opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none' }}
              onMouseEnter={() => setHoveredCloseId(tab.id)} onMouseLeave={() => setHoveredCloseId(null)}
              onClick={() => onClose(tab.id)} aria-label={`Close ${tab.title}`}
              title={showsDot ? 'Unsaved changes — click to close' : undefined}>
              {showsDot ? (
                <span data-testid="tab-unsaved" role="img" aria-label="Unsaved changes"
                  style={{ width: 7, height: 7, borderRadius: t.RADIUS_PILL, background: t.TEXT_MUTED }} />
              ) : (
                <CloseIcon style={iconSvg} aria-hidden="true" />
              )}
            </button>
          </div>
        );
      })}
      {onNewTab && (
        <button data-testid="tab-new" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: t.TAB_H, border: 'none', borderLeft: `1px solid ${t.BORDER}`, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer' }}
          onClick={onNewTab} aria-label="New query tab">
          <NewTabIcon style={iconSvg} aria-hidden="true" />
        </button>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * The insertion line. Absolutely positioned rather than a border on the tab, so
 * showing it never widens anything -- a 2px border appearing under the pointer
 * would shove every tab to its right and move the target out from under the drop.
 */
function DropMark({ side }: { side: 'left' | 'right' }) {
  return <div data-testid="tab-drop-mark" aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, [side]: 0, width: 2, background: t.ACCENT, pointerEvents: 'none' }} />;
}
