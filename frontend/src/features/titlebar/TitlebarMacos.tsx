import { useEffect, useState } from 'react';
import { useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { AssistantIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import AboutDialog from './AboutDialog.tsx';
import EnvironmentsDialog from './EnvironmentsDialog.tsx';
import ExportConnectionsDialog from './ExportConnectionsDialog.tsx';
import ImportConnectionsDialog from './ImportConnectionsDialog.tsx';
import ShortcutsDialog from './ShortcutsDialog.tsx';
import { useAbout } from './useAbout.ts';
import { useWindowChrome } from './useWindowChrome.ts';
import { useUpdater } from '../updater/index.ts';

/**
 * macOS-styled traffic-light buttons drawn on the left of a borderless window.
 *
 * The native menu bar at the top of the screen (NSMenuBar) is always present when
 * the app is in the foreground, but Neutralino never populates it — unlike
 * Windows, where File/About live in our own custom titlebar HTML, macOS gets
 * nothing there unless something puts it there. scripts/macos-window-chrome.m
 * builds a literal File/About NSMenu (mirroring Titlebar.tsx's items exactly)
 * and, since clicking a native menu item can't call a React handler directly,
 * evaluates a small JS snippet in the webview that dispatches a `squeal:menu`
 * CustomEvent. This effect is the other end of that pipe.
 */

const DOT_SIZE = 12;
const DOT_GAP = 8;
const DOT_LEFT = 12;
const LIGHTS_W = DOT_LEFT + DOT_SIZE * 3 + DOT_GAP * 2;

const ASSISTANT_W = 34;

const RED = '#ff5f57';
const YELLOW = '#febc2e';
const GREEN = '#28c840';

const RED_HOVER = '#c7352e';
const YELLOW_HOVER = '#d49a1e';
const GREEN_HOVER = '#1e9e30';

const RED_GLYPH = '#4d0000';
const YELLOW_GLYPH = '#8a5300';
const GREEN_GLYPH = '#0a4d0a';

const dotBase: React.CSSProperties = {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'block',
    padding: 0,
    flex: 'none',
};

// The viewBox is the size of the dot so a glyph is centered by its own
// coordinates. Art smaller than the dot puts half the stroke outside the
// viewBox, where the browser clips it by a different amount per glyph.
const glyph = (colour: string, d: string) => (
    <svg
        width={DOT_SIZE}
        height={DOT_SIZE}
        viewBox={`0 0 ${DOT_SIZE} ${DOT_SIZE}`}
        aria-hidden="true"
        style={{ display: 'block' }}
    >
        <path d={d} stroke={colour} strokeWidth="1.15" strokeLinecap="round" fill="none" />
    </svg>
);

const closeSymbol = glyph(RED_GLYPH, 'M4.2 4.2l3.6 3.6M7.8 4.2l-3.6 3.6');
const minimizeSymbol = glyph(YELLOW_GLYPH, 'M3.6 6h4.8');

// Deliberately not keyed on `maximized`: macOS swaps this glyph between
// fullscreen and zoom, not between zoomed and not, and this button is a zoom.
const zoomSymbol = (
    <svg
        width={DOT_SIZE}
        height={DOT_SIZE}
        viewBox={`0 0 ${DOT_SIZE} ${DOT_SIZE}`}
        aria-hidden="true"
        style={{ display: 'block' }}
    >
        <path d="M3.7 3.7h2.8l-2.8 2.8z M8.3 8.3h-2.8l2.8-2.8z" fill={GREEN_GLYPH} />
    </svg>
);

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
    const [hovered, setHovered] = useState<string | null>(null);
    const [lightsHovered, setLightsHovered] = useState(false);
    const [assistantHovered, setAssistantHovered] = useState(false);
    const [showingAbout, setShowingAbout] = useState(false);
    const [showingEnvironments, setShowingEnvironments] = useState(false);
    const [showingExport, setShowingExport] = useState(false);
    const [showingImport, setShowingImport] = useState(false);
    const [showingShortcuts, setShowingShortcuts] = useState(false);

    useEffect(() => {
        function onNativeMenu(e: Event): void {
            switch ((e as CustomEvent<string>).detail) {
                case 'exit':
                    close();
                    break;
                case 'environments':
                    setShowingEnvironments(true);
                    break;
                case 'exportConnections':
                    setShowingExport(true);
                    break;
                case 'importConnections':
                    setShowingImport(true);
                    break;
                case 'shortcuts':
                    setShowingShortcuts(true);
                    break;
                case 'relationshipDiagram':
                    onOpenDiagram?.();
                    break;
                case 'checkForUpdates':
                    check(true);
                    break;
                case 'about':
                    setShowingAbout(true);
                    break;
                case 'openDataDir':
                    openDataDir();
                    break;
            }
        }
        window.addEventListener('squeal:menu', onNativeMenu);
        return () => window.removeEventListener('squeal:menu', onNativeMenu);
    }, [close, check, openDataDir, onOpenDiagram]);

    const dot = (colour: string, hoverColour: string, name: string, symbol: React.ReactNode) => (
        <button
            key={name}
            style={{
                ...dotBase,
                background: hovered === name ? hoverColour : colour,
            }}
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered(null)}
            onClick={(e) => {
                e.stopPropagation();
                if (name === 'close') close();
                else if (name === 'minimize') minimize();
                else void toggleMaximize();
            }}
            aria-label={
                name === 'close'
                    ? 'Close'
                    : name === 'minimize'
                      ? 'Minimise'
                      : maximized
                        ? 'Restore'
                        : 'Zoom'
            }
            title={
                name === 'close'
                    ? 'Close'
                    : name === 'minimize'
                      ? 'Minimise'
                      : maximized
                        ? 'Restore'
                        : 'Zoom'
            }
        >
            {lightsHovered ? symbol : null}
        </button>
    );

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
            {showingAbout && (
                <AboutDialog version={version} onClose={() => setShowingAbout(false)} />
            )}
            {showingEnvironments && (
                <EnvironmentsDialog onClose={() => setShowingEnvironments(false)} />
            )}
            {showingExport && <ExportConnectionsDialog onClose={() => setShowingExport(false)} />}
            {showingImport && <ImportConnectionsDialog onClose={() => setShowingImport(false)} />}
            {showingShortcuts && <ShortcutsDialog onClose={() => setShowingShortcuts(false)} />}
            {/* Traffic-light buttons. The symbols are revealed by hovering the *group*,
          not the individual dot, because that is what macOS does -- pointing at
          any one of the three lights labels all three. Only the dot actually
          under the pointer takes the darker shade. */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: DOT_GAP,
                    flex: 'none',
                    paddingLeft: DOT_LEFT,
                }}
                onMouseEnter={() => setLightsHovered(true)}
                onMouseLeave={() => {
                    setLightsHovered(false);
                    setHovered(null);
                }}
            >
                {dot(RED, RED_HOVER, 'close', closeSymbol)}
                {dot(YELLOW, YELLOW_HOVER, 'minimize', minimizeSymbol)}
                {dot(GREEN, GREEN_HOVER, 'zoom', zoomSymbol)}
            </div>

            {/* Drag region + window title */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 1,
                    minWidth: 0,
                    height: '100%',
                }}
                {...dragProps}
            >
                <span
                    style={{
                        overflow: 'hidden',
                        color: t.TEXT_MUTED,
                        fontSize: t.TEXT_BADGE,
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {connected ? (
                        <span style={{ fontFamily: t.MONO }}>{serverLabel}</span>
                    ) : (
                        'Squeal Editor'
                    )}
                </span>
            </div>

            {/* The assistant button lives inside the row that balances the traffic
          lights, rather than beside it, so the title stays centred: the row is
          LIGHTS_W wide either way and the button spends part of that width
          instead of adding to it. */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: LIGHTS_W,
                    flex: 'none',
                    height: '100%',
                }}
            >
                <button
                    data-testid="titlebar-assistant"
                    disabled={!onOpenAssistant}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: ASSISTANT_W,
                        height: '100%',
                        border: 'none',
                        padding: 0,
                        position: 'relative',
                        background: assistantHovered && onOpenAssistant ? t.HOVER : 'none',
                        color: assistantHovered && onOpenAssistant ? t.TEXT : t.TEXT_MUTED,
                        opacity: onOpenAssistant ? 1 : 0.4,
                        cursor: onOpenAssistant ? 'pointer' : 'default',
                    }}
                    onMouseEnter={() => setAssistantHovered(true)}
                    onMouseLeave={() => setAssistantHovered(false)}
                    onClick={() => onOpenAssistant?.()}
                    aria-label="New assistant chat"
                    title="New assistant chat"
                >
                    <AssistantIcon style={{ width: t.ICON, height: t.ICON }} />
                    {assistantRunning && (
                        <span
                            data-testid="titlebar-assistant-busy"
                            aria-hidden="true"
                            style={{
                                position: 'absolute',
                                top: 6,
                                right: 4,
                                width: 5,
                                height: 5,
                                borderRadius: t.RADIUS_PILL,
                                background: t.ACCENT,
                            }}
                        />
                    )}
                </button>
            </div>
        </header>
    );
}
