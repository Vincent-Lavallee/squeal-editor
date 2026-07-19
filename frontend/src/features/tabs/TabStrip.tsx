import { CloseIcon, NewTabIcon, QueryIcon, TableIcon } from '../../common/icons/icons.ts';
import { useTabs } from '../../store/tabsSlice.ts';

/**
 * What is open, across the top of the main pane.
 *
 * The tab *list* lives in `store/`, the way the session does and for the same
 * reason: every feature reads it, so a feature owning it would be a hub in
 * everything but name. This feature owns the strip you click, not the tabs it
 * draws -- `features/connections` is the same shape.
 */
export default function TabStrip() {
  const { tabs, activeTabId, activeTab, activateTab, closeTab, openEditorTab } = useTabs();

  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        // Shape tells the two kinds apart before the label is read.
        const Icon = tab.kind === 'grid' ? TableIcon : QueryIcon;

        return (
          /*
           * A row rather than one button, because the close button lives inside
           * it and a <button> cannot contain a <button>. This is the
           * `.saved__row` structure exactly.
           */
          <div className={`tabs__tab ${active ? 'tabs__tab--active' : ''}`} key={tab.id}>
            <button
              className="tabs__pick"
              role="tab"
              aria-selected={active}
              onClick={() => activateTab(tab.id)}
              title={tab.database ? `${tab.title} — ${tab.database}` : tab.title}
            >
              <Icon className="icon tabs__icon" aria-hidden="true" />
              <span className="tabs__label">{tab.title}</span>
            </button>

            <button className="tabs__close" onClick={() => closeTab(tab.id)} aria-label={`Close ${tab.title}`}>
              <CloseIcon className="icon" aria-hidden="true" />
            </button>
          </div>
        );
      })}

      {/*
        A new tab opens on the database you are already looking at -- the only
        answer that does not make a second query against the same database cost a
        trip to the picker. From the empty state there is no tab to inherit from,
        and the slice falls back to the session's default rather than to nothing:
        a tab pointed at nothing has an empty tree and nothing to run.
      */}
      <button className="tabs__new" onClick={() => openEditorTab(activeTab?.database)} aria-label="New query tab">
        <NewTabIcon className="icon" aria-hidden="true" />
      </button>
    </div>
  );
}
