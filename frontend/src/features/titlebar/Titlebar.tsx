import { useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import * as t from '../../common/tokens';
import Menu from './menu/Menu.tsx';
import NewAssistantChatButton from './assistant/NewAssistantChatButton.tsx';
import TitlebarDialogs from './dialogs/TitlebarDialogs.tsx';
import TitlebarTitle from './TitlebarTitle.tsx';
import { WindowResizeTop } from './window-chrome/WindowResizeEdge.tsx';
import WindowControls from './window-chrome/WindowControls.tsx';
import { useAbout } from './dialogs/hooks/useAbout.ts';
import { useTitlebarDialogs } from './dialogs/hooks/useTitlebarDialogs.ts';
import { useWindowChrome } from './window-chrome/hooks/useWindowChrome.ts';

interface Props {
    onCheckForUpdates: () => void;
    /**
     * Undefined whenever there is no shell to draw a diagram in -- the connect
     * screen, or a connection still being added. The *Database* menu is then not
     * rendered at all, rather than offered and refusing: it is a menu about the
     * database you are looking at, and there is not one.
     */
    onOpenDiagram?: () => void;
    /**
     * Undefined on the connect screen, for `onOpenDiagram`'s reason: the tab it
     * opens lives in a connection's strip, and there is not one. The button is
     * hidden there rather than drawn disabled -- a disabled control that should
     * work reads as broken -- and the title's centring, which the button balances,
     * is accepted as the cost.
     */
    onOpenAssistant?: () => void;
}

export default function Titlebar({ onCheckForUpdates, onOpenDiagram, onOpenAssistant }: Props) {
    const {
        maximized,
        minimize,
        toggleMaximize,
        close,
        beginResize,
        needsTopResizeStrips,
        dragProps,
    } = useWindowChrome();
    const { connected, serverLabel } = useSession();
    // *Any* conversation, not one: several assistant tabs can be open, and what
    // the dot means here is "the assistant is working", which is about the app
    // rather than about whichever tab happens to be in front.
    const assistantRunning = useAppSelector((s) =>
        Object.values(s.assistant.byTab).some((conversation) => conversation.turnId !== null),
    );
    const { version, openDataDir } = useAbout();
    const dialogs = useTitlebarDialogs();

    const fileItems = [
        { label: 'Environments', onSelect: dialogs.open.environments },
        { label: 'Export connections', onSelect: dialogs.open.export },
        { label: 'Import connections', onSelect: dialogs.open.import },
        { label: 'Exit', onSelect: close },
    ];
    const databaseItems = [{ label: 'Relationship diagram', onSelect: () => onOpenDiagram?.() }];
    const preferencesItems = [{ label: 'Keyboard shortcuts', onSelect: dialogs.open.shortcuts }];
    const aboutItems = [
        { label: 'Check for updates', onSelect: onCheckForUpdates },
        { label: 'Version', onSelect: dialogs.open.about },
        { label: 'Open app data', onSelect: openDataDir },
    ];

    return (
        <header
            style={{
                display: 'flex',
                alignItems: 'center',
                flex: 'none',
                height: t.TITLEBAR_H,
                paddingLeft: t.GAP_SM,
                borderBottom: `1px solid ${t.BORDER}`,
                userSelect: 'none',
            }}
        >
            <Menu label="File" items={fileItems} />
            {onOpenDiagram && <Menu label="Database" items={databaseItems} />}
            <Menu label="Preferences" items={preferencesItems} />
            <Menu label="About" items={aboutItems} />
            <TitlebarDialogs version={version} showing={dialogs.showing} onClose={dialogs.close} />
            <TitlebarTitle connected={connected} serverLabel={serverLabel} dragProps={dragProps} />
            <NewAssistantChatButton onOpenAssistant={onOpenAssistant} running={assistantRunning} />
            <WindowControls
                maximized={maximized}
                minimize={minimize}
                toggleMaximize={toggleMaximize}
                close={close}
            />
            {/* Window furniture rather than titlebar content: fixed to the viewport,
          and rendered from here only because `useWindowChrome` -- which knows
          whether the top border still exists -- is this component's hook and
          calling it twice would run the startup chrome twice. Never while
          maximised: dragging the edge of a maximised window resizes nothing. */}
            {needsTopResizeStrips && !maximized && <WindowResizeTop onBegin={beginResize} />}
        </header>
    );
}
