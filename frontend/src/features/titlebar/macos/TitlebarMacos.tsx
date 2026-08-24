import { useAppSelector } from '../../../store/hooks.ts';
import { useSession } from '../../../store/sessionSlice.ts';
import * as t from '../../../common/tokens';
import MacosAssistantButton from '../assistant/MacosAssistantButton.tsx';
import MacosTitlebarTitle from './MacosTitlebarTitle.tsx';
import TitlebarDialogs from '../dialogs/TitlebarDialogs.tsx';
import TrafficLights from './TrafficLights.tsx';
import { useAbout } from '../dialogs/hooks/useAbout.ts';
import { useNativeMenuBridge } from '../menu/hooks/useNativeMenuBridge.ts';
import { useTitlebarDialogs } from '../dialogs/hooks/useTitlebarDialogs.ts';
import { useWindowChrome } from '../window-chrome/hooks/useWindowChrome.ts';
import { useUpdater } from '../../updater/index.ts';

interface Props {
    /**
     * Undefined whenever there is no shell to draw a diagram in. The native menu
     * item cannot come and go the way the Windows one does -- `installMenuBar`
     * builds the bar once, at launch, from a process that cannot see React state
     * -- so on macOS the item is always there and does nothing on the connect
     * screen. That is the one place the two titlebars deliberately differ.
     */
    onOpenDiagram?: () => void;
    /**
     * Undefined on the connect screen, for `onOpenDiagram`'s reason: the tab it
     * opens lives in a connection's strip, and there is not one. Drawn disabled
     * rather than hidden, exactly as on Windows -- it sits in the row that
     * balances the traffic lights, and a gap there would slide the window title
     * off centre.
     */
    onOpenAssistant?: () => void;
}

/**
 * macOS-styled traffic-light buttons drawn on the left of a borderless window.
 * See `useNativeMenuBridge` for how the native File/About menu (built by
 * scripts/macos-window-chrome.m) reaches this component's dialogs.
 */
export default function TitlebarMacos({ onOpenDiagram, onOpenAssistant }: Props) {
    const { maximized, minimize, toggleMaximize, close, dragProps } = useWindowChrome();
    const { connected, serverLabel } = useSession();
    const { version, openDataDir } = useAbout();
    const { check } = useUpdater();
    // *Any* conversation, not one: several assistant tabs can be open, and what
    // the dot means here is "the assistant is working", which is about the app
    // rather than about whichever tab happens to be in front.
    const assistantRunning = useAppSelector((s) =>
        Object.values(s.assistant.byTab).some((conversation) => conversation.turnId !== null),
    );
    const dialogs = useTitlebarDialogs();
    useNativeMenuBridge({ close, check, openDataDir, onOpenDiagram, dialogs });

    return (
        <header
            style={{
                display: 'flex',
                alignItems: 'center',
                flex: 'none',
                height: t.TITLEBAR_H,
                borderBottom: `1px solid ${t.BORDER}`,
                userSelect: 'none',
                background: t.BG,
            }}
        >
            <TitlebarDialogs version={version} showing={dialogs.showing} onClose={dialogs.close} />
            <TrafficLights
                maximized={maximized}
                minimize={minimize}
                toggleMaximize={toggleMaximize}
                close={close}
            />
            <MacosTitlebarTitle
                connected={connected}
                serverLabel={serverLabel}
                dragProps={dragProps}
            />
            <MacosAssistantButton onOpenAssistant={onOpenAssistant} running={assistantRunning} />
        </header>
    );
}
