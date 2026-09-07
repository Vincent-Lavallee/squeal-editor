import type { useTitlebarDialogs } from '../../dialogs/hooks/useTitlebarDialogs.ts';

interface MenuItem {
    label: string;
    onSelect: () => void;
}

/**
 * The four menus' items, as plain data -- split out of `Titlebar` purely for
 * length, the same reason `ConnectionFormFields` exists. Nothing here is
 * memoised: `Menu` re-subscribes nothing off `items`, it just reads them on
 * the render that opens.
 */
export function useTitlebarMenus(options: {
    dialogs: ReturnType<typeof useTitlebarDialogs>;
    close: () => void;
    onOpenDiagram?: () => void;
    onCheckForUpdates: () => void;
    openDataDir: () => void;
}): {
    fileItems: MenuItem[];
    databaseItems: MenuItem[];
    preferencesItems: MenuItem[];
    aboutItems: MenuItem[];
} {
    const { dialogs, close, onOpenDiagram, onCheckForUpdates, openDataDir } = options;

    return {
        fileItems: [
            { label: 'Environments', onSelect: dialogs.open.environments },
            { label: 'Export connections', onSelect: dialogs.open.export },
            { label: 'Import connections', onSelect: dialogs.open.import },
            { label: 'Exit', onSelect: close },
        ],
        databaseItems: [{ label: 'Relationship diagram', onSelect: () => onOpenDiagram?.() }],
        preferencesItems: [
            { label: 'Keyboard shortcuts', onSelect: dialogs.open.shortcuts },
            { label: 'Settings', onSelect: dialogs.open.settings },
        ],
        aboutItems: [
            { label: 'Check for updates', onSelect: onCheckForUpdates },
            { label: 'Version', onSelect: dialogs.open.about },
            { label: 'Open app data', onSelect: openDataDir },
        ],
    };
}
