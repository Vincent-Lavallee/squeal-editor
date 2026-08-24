import type { MenuItem } from '../../../common/components/ContextMenu.tsx';
import type { Tab } from '../../../store/tabsSlice.ts';

interface Options {
    tabList: Tab[];
    onSaveTab?: (tabId: string) => void;
    onDuplicateTab?: (tabId: string) => void;
    onClose: (id: string) => void;
    onCloseOthers: (id: string) => void;
    onCloseToTheRight: (id: string) => void;
    onCloseAll: () => void;
    onStartRename: (id: string, draft: string) => void;
}

/** The tab's right-click menu. Split out of `TabStrip` purely for length. */
export function useTabMenuItems({
    tabList,
    onSaveTab,
    onDuplicateTab,
    onClose,
    onCloseOthers,
    onCloseToTheRight,
    onCloseAll,
    onStartRename,
}: Options) {
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
            { label: 'Rename', onSelect: () => onStartRename(id, tab?.title ?? '') },
            {
                label: 'Save',
                disabled: !holdsText || !onSaveTab,
                title: holdsText ? undefined : 'Only a query tab has text to save',
                onSelect: () => onSaveTab?.(id),
            },
            { label: 'Duplicate', disabled: !onDuplicateTab, onSelect: () => onDuplicateTab?.(id) },
            { label: 'Close', onSelect: () => onClose(id) },
            { label: 'Close others', disabled: only, onSelect: () => onCloseOthers(id) },
            {
                label: 'Close Tabs to the Right',
                disabled: last,
                onSelect: () => onCloseToTheRight(id),
            },
            { label: 'Close All', onSelect: () => onCloseAll() },
        ];
    };

    return { menuItems };
}
