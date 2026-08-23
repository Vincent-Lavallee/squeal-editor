import type { Tab } from '../../store/tabsSlice.ts';
import Button from '../../common/components/Button.tsx';
import Modal from '../../common/components/Modal.tsx';
import * as t from '../../common/tokens';
import CloseTabsList from './CloseTabsList.tsx';
import CloseTabsMessage from './CloseTabsMessage.tsx';

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
                onSubmit={(e) => {
                    e.preventDefault();
                    onConfirm();
                }}
            >
                <CloseTabsMessage tabs={tabs} one={one} />
                {!one && <CloseTabsList tabs={tabs} />}

                <div style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
                    <Button type="button" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        data-testid="modal-submit"
                        variant="primary"
                        style={{ justifyContent: 'center', flex: 1 }}
                        autoFocus
                    >
                        {one ? 'Close without saving' : 'Close all without saving'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
