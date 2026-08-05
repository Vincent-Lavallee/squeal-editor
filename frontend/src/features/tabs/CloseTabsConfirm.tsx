import type { Tab } from '../../store/tabsSlice.ts';
import Button from '../../common/components/Button.tsx';
import Modal from '../../common/components/Modal.tsx';
import * as t from '../../common/tokens';

interface Props {
  /** The tabs in the set that would lose text — never empty, or nothing would have asked. */
  tabs: Tab[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The last stop before a close destroys text that exists nowhere else.
 *
 * One dialog for the whole gesture rather than one per tab, the same shape
 * `tabsClosed` already has: closing several tabs is one decision, and Cancel
 * closes none of them. It names the tabs it would take, because "3 tabs" is not
 * enough to decide with when one of them is the one you care about.
 *
 * Two buttons and not three. *Save* here would mean Ctrl+S, which for a tab that
 * came from nowhere opens the name dialog — a dialog summoned by a dialog — and
 * most of the tabs this asks about are exactly that kind.
 */
export default function CloseTabsConfirm({ tabs, onConfirm, onCancel }: Props) {
  const one = tabs.length === 1;

  return (
    <Modal onClose={onCancel}>
      <form
        data-testid="close-confirm"
        style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
        onSubmit={(e) => { e.preventDefault(); onConfirm(); }}
      >
        <h2 style={{ margin: `0 0 ${t.GAP}px`, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
          {one ? `Close ${tabs[0]!.title}?` : `Close ${tabs.length} tabs with unsaved changes?`}
        </h2>
        <p style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY, lineHeight: 1.5 }}>
          {one
            ? 'Its query has not been saved, and closing the tab discards it.'
            : 'Their queries have not been saved, and closing the tabs discards them.'}
        </p>

        {!one && (
          <ul data-testid="close-confirm-list" style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_XS, margin: `0 0 ${t.GAP_SM}px`, padding: 0, listStyle: 'none', color: t.TEXT, fontSize: t.TEXT_BODY }}>
            {tabs.map((tab) => (
              <li key={tab.id} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
          <Button type="button" onClick={onCancel}>Cancel</Button>
          <Button type="submit" data-testid="modal-submit" variant="primary" style={{ justifyContent: 'center', flex: 1 }} autoFocus>
            {one ? 'Close without saving' : 'Close all without saving'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
