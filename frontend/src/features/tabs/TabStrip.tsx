import { useEffect, useRef, useState } from 'react';
import { CloseIcon, NewTabIcon, QueryIcon, TableIcon } from '../../common/icons/icons.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

/**
 * Where a dragged tab would land: in front of a tab, or at the end (`null`).
 * `undefined` is the third state and not a sloppy one -- it is "the drag has not
 * been over anything yet", which `null` is already spoken for and cannot say.
 */
type DropAt = string | null | undefined;

interface Props {
  /**
   * Duplicating copies the query text, which lives in the editor's context and
   * not in the tab -- so it is wired in the composition root like every other
   * thing that spans two features, and arrives here as a prop.
   */
  onDuplicateTab?: (tabId: string) => void;
}

export default function TabStrip({ onDuplicateTab }: Props) {
  const { tabs: tabList, activeTabId, activateTab, closeTab, closeOtherTabs, closeTabsToTheRight, closeAllTabs, moveTab, openEditorTab, renameTab } = useTabs();
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt>(undefined);
  // The draft while typing. Component state, not the store: `title` only earns a
  // dispatch on commit (blur/Enter), the same split the grid draws between an
  // in-progress cell edit and the value it saves.
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const commitRename = () => {
    if (renaming) renameTab(renaming.id, renaming.draft);
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

  const endDrag = () => { setDraggingId(null); setDropAt(undefined); };

  const drop = () => {
    if (draggingId && dropAt !== undefined) moveTab(draggingId, dropAt);
    endDrag();
  };

  // The half the pointer is on decides which side of this tab the drop lands:
  // past the midpoint means in front of the *next* one, which at the end of the
  // strip is `null`.
  const dragOverTab = (index: number) => (e: React.DragEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > box.left + box.width / 2;
    setDropAt(after ? (tabList[index + 1]?.id ?? null) : tabList[index]!.id);
  };

  const menuItems = (id: string): MenuItem[] => {
    const index = tabList.findIndex((tab) => tab.id === id);
    const only = tabList.length === 1;
    const last = index === tabList.length - 1;
    return [
      { label: 'Duplicate', disabled: !onDuplicateTab, onSelect: () => onDuplicateTab?.(id) },
      { label: 'Close All Except Current', disabled: only, onSelect: () => closeOtherTabs(id) },
      { label: 'Close Tabs to the Right', disabled: last, onSelect: () => closeTabsToTheRight(id) },
      { label: 'Close All', onSelect: () => closeAllTabs() },
    ];
  };

  return (
    <div data-testid="tabs" style={{ display: 'flex', alignItems: 'stretch', minWidth: 0, borderBottom: `1px solid ${t.BORDER}`, overflowX: 'auto', scrollbarWidth: 'none' }} role="tablist"
      onDragOver={(e) => { if (draggingId) e.preventDefault(); }} onDrop={drop}>
      {tabList.map((tab, index) => {
        const active = tab.id === activeTabId;
        const hovered = hoveredTabId === tab.id;
        const Icon = tab.kind === 'grid' ? TableIcon : QueryIcon;
        // Not on the tab being dragged: an insertion mark on the thing you are
        // holding says a move that is no move at all.
        const marked = dropAt !== undefined && dropAt !== draggingId;

        return (
          <div data-testid="tab" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', maxWidth: 200, paddingRight: t.GAP_XS, opacity: tab.id === draggingId ? 0.4 : 1, ...(active ? { background: t.SELECTED, color: t.ACCENT } : {}) }}
            key={tab.id} onMouseEnter={() => setHoveredTabId(tab.id)} onMouseLeave={() => setHoveredTabId(null)}
            // Not draggable mid-rename: a drag reads the tab id off this
            // element regardless of what is focused inside it, and a text
            // selection dragged from the input has no business moving the tab.
            draggable={renaming?.id !== tab.id}
            onDragStart={(e) => { setDraggingId(tab.id); e.dataTransfer?.setData('text/plain', tab.id); }} onDragEnd={endDrag}
            onDragOver={dragOverTab(index)} onContextMenu={(e) => { e.preventDefault(); setMenu({ id: tab.id, x: e.clientX, y: e.clientY }); }}>

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
                role="tab" aria-selected={active} onClick={() => activateTab(tab.id)} title={tab.title}>
                <Icon style={{ ...iconSvg, color: active ? 'inherit' : t.TEXT_MUTED }} aria-hidden="true" />
                <span data-testid="tab-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ id: tab.id, draft: tab.title }); }}>{tab.title}</span>
              </button>
            )}
            <button data-testid="tab-close" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 20, height: 20, padding: 0, border: 'none', borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer', opacity: active || hovered ? 1 : 0, pointerEvents: active || hovered ? 'auto' : 'none' }}
              onClick={() => closeTab(tab.id)} aria-label={`Close ${tab.title}`}>
              <CloseIcon style={iconSvg} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button data-testid="tab-new" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: t.TAB_H, border: 'none', borderLeft: `1px solid ${t.BORDER}`, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer' }}
        onClick={() => openEditorTab()} aria-label="New query tab">
        <NewTabIcon style={iconSvg} aria-hidden="true" />
      </button>

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
