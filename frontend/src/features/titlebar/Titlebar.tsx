import { useState } from 'react';
import { useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { AssistantIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import AboutDialog from './AboutDialog.tsx';
import EnvironmentsDialog from './EnvironmentsDialog.tsx';
import ExportConnectionsDialog from './ExportConnectionsDialog.tsx';
import ImportConnectionsDialog from './ImportConnectionsDialog.tsx';
import Menu from './Menu.tsx';
import ShortcutsDialog from './ShortcutsDialog.tsx';
import { WindowResizeTop } from './WindowResizeEdge.tsx';
import { useAbout } from './useAbout.ts';
import { useWindowChrome } from './useWindowChrome.ts';

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
     * drawn disabled rather than hidden, unlike the *Database* menu, because it is
     * in a fixed row of controls and a gap would move its neighbours.
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
    const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
    const [showingAbout, setShowingAbout] = useState(false);
    const [showingEnvironments, setShowingEnvironments] = useState(false);
    const [showingExport, setShowingExport] = useState(false);
    const [showingImport, setShowingImport] = useState(false);
    const [showingShortcuts, setShowingShortcuts] = useState(false);

    const fileItems = [
        { label: 'Environments', onSelect: () => setShowingEnvironments(true) },
        { label: 'Export connections', onSelect: () => setShowingExport(true) },
        { label: 'Import connections', onSelect: () => setShowingImport(true) },
        { label: 'Exit', onSelect: close },
    ];

    const databaseItems = [{ label: 'Relationship diagram', onSelect: () => onOpenDiagram?.() }];

    const preferencesItems = [
        { label: 'Keyboard shortcuts', onSelect: () => setShowingShortcuts(true) },
    ];

    const aboutItems = [
        { label: 'Check for updates', onSelect: onCheckForUpdates },
        { label: 'Version', onSelect: () => setShowingAbout(true) },
        { label: 'Open app data', onSelect: openDataDir },
    ];

    const btnStyle = (name: string): React.CSSProperties => ({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 46,
        height: '100%',
        border: 'none',
        background: 'none',
        color: t.TEXT_MUTED,
        cursor: 'pointer',
        ...(hoveredBtn === name
            ? { background: name === 'close' ? t.RED : t.HOVER, color: t.TEXT }
            : {}),
    });

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
            {showingAbout && (
                <AboutDialog version={version} onClose={() => setShowingAbout(false)} />
            )}
            {showingEnvironments && (
                <EnvironmentsDialog onClose={() => setShowingEnvironments(false)} />
            )}
            {showingExport && <ExportConnectionsDialog onClose={() => setShowingExport(false)} />}
            {showingImport && <ImportConnectionsDialog onClose={() => setShowingImport(false)} />}
            {showingShortcuts && <ShortcutsDialog onClose={() => setShowingShortcuts(false)} />}
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
                    data-testid="titlebar-title"
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
            {/* Before the window controls, and narrower than them: it is the app's
          button rather than the platform's, and matching their 46px would read
          as a fourth window control. */}
            <button
                data-testid="titlebar-assistant"
                disabled={!onOpenAssistant}
                style={{
                    ...btnStyle('assistant'),
                    position: 'relative',
                    width: 34,
                    opacity: onOpenAssistant ? 1 : 0.4,
                    cursor: onOpenAssistant ? 'pointer' : 'default',
                }}
                onMouseEnter={() => setHoveredBtn('assistant')}
                onMouseLeave={() => setHoveredBtn(null)}
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
                            right: 6,
                            width: 5,
                            height: 5,
                            borderRadius: t.RADIUS_PILL,
                            background: t.ACCENT,
                        }}
                    />
                )}
            </button>

            <div style={{ display: 'flex', flex: 'none', height: '100%' }}>
                {(['minimize', 'maximize', 'close'] as const).map((name) => (
                    <button
                        key={name}
                        data-testid="titlebar-btn"
                        style={btnStyle(name)}
                        onMouseEnter={() => setHoveredBtn(name)}
                        onMouseLeave={() => setHoveredBtn(null)}
                        onClick={
                            name === 'minimize'
                                ? minimize
                                : name === 'maximize'
                                  ? () => void toggleMaximize()
                                  : close
                        }
                        aria-label={
                            name === 'minimize'
                                ? 'Minimise'
                                : name === 'maximize'
                                  ? maximized
                                      ? 'Restore'
                                      : 'Maximise'
                                  : 'Close'
                        }
                        title={
                            name === 'minimize'
                                ? 'Minimise'
                                : name === 'maximize'
                                  ? maximized
                                      ? 'Restore'
                                      : 'Maximise'
                                  : 'Close'
                        }
                    >
                        {name === 'minimize' ? (
                            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                                <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
                            </svg>
                        ) : name === 'maximize' ? (
                            maximized ? (
                                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                                    <path
                                        d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1"
                                    />
                                </svg>
                            ) : (
                                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                                    <rect
                                        x="0.5"
                                        y="0.5"
                                        width="9"
                                        height="9"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1"
                                    />
                                </svg>
                            )
                        ) : (
                            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                                <path
                                    d="M0 0l10 10M10 0L0 10"
                                    stroke="currentColor"
                                    strokeWidth="1"
                                />
                            </svg>
                        )}
                    </button>
                ))}
            </div>
            {/* Window furniture rather than titlebar content: fixed to the viewport,
          and rendered from here only because `useWindowChrome` -- which knows
          whether the top border still exists -- is this component's hook and
          calling it twice would run the startup chrome twice. Never while
          maximised: dragging the edge of a maximised window resizes nothing. */}
            {needsTopResizeStrips && !maximized && <WindowResizeTop onBegin={beginResize} />}
        </header>
    );
}
