import { useState } from 'react';
import { CloseIcon, NewTabIcon, QueryIcon, TableIcon } from '../../common/icons/icons.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function TabStrip() {
  const { tabs: tabList, activeTabId, activeTab, activateTab, closeTab, openEditorTab } = useTabs();
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  return (
    <div data-testid="tabs" style={{ display: 'flex', alignItems: 'stretch', minWidth: 0, borderBottom: `1px solid ${t.BORDER}`, overflowX: 'auto', scrollbarWidth: 'none' }} role="tablist">
      {tabList.map((tab) => {
        const active = tab.id === activeTabId;
        const hovered = hoveredTabId === tab.id;
        const Icon = tab.kind === 'grid' ? TableIcon : QueryIcon;

        return (
          <div data-testid="tab" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', maxWidth: 200, paddingRight: t.GAP_XS, ...(active ? { background: t.SELECTED, color: t.ACCENT } : {}) }}
            key={tab.id} onMouseEnter={() => setHoveredTabId(tab.id)} onMouseLeave={() => setHoveredTabId(null)}>
            <button data-testid="tab-pick" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 1, minWidth: 0, height: t.TAB_H, padding: `0 ${t.GAP_XS}px 0 10px`, border: 'none', background: 'none', color: 'inherit', font: 'inherit', fontSize: t.TEXT_BADGE, cursor: 'pointer' }}
              role="tab" aria-selected={active} onClick={() => activateTab(tab.id)} title={tab.database ? `${tab.title} — ${tab.database}` : tab.title}>
              <Icon style={{ ...iconSvg, color: active ? 'inherit' : t.TEXT_MUTED }} aria-hidden="true" />
              <span data-testid="tab-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</span>
            </button>
            <button data-testid="tab-close" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 20, height: 20, padding: 0, border: 'none', borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer', opacity: active || hovered ? 1 : 0, pointerEvents: active || hovered ? 'auto' : 'none' }}
              onClick={() => closeTab(tab.id)} aria-label={`Close ${tab.title}`}>
              <CloseIcon style={iconSvg} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button data-testid="tab-new" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: t.TAB_H, border: 'none', borderLeft: `1px solid ${t.BORDER}`, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer' }}
        onClick={() => openEditorTab(activeTab?.database)} aria-label="New query tab">
        <NewTabIcon style={iconSvg} aria-hidden="true" />
      </button>
    </div>
  );
}
