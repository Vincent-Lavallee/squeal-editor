import { useSession } from '../../store/sessionSlice.ts';
import FileMenu from './FileMenu.tsx';
import { useWindowChrome } from './useWindowChrome.ts';

/**
 * The window's own titlebar, replacing the native one.
 *
 * It sits above the router rather than inside the shell: the window has chrome
 * whether or not a connection is open, and a borderless window with no way to
 * close it is a trap.
 */
export default function Titlebar() {
  const { maximized, minimize, toggleMaximize, close, dragProps } = useWindowChrome();
  const { connected, serverLabel, disconnect } = useSession();

  const items = [
    ...(connected ? [{ label: 'Disconnect', onSelect: disconnect }] : []),
    { label: 'Exit', onSelect: close },
  ];

  return (
    <header className="titlebar">
      <FileMenu items={items} />

      {/* Everything between the menu and the buttons moves the window. */}
      <div className="titlebar__drag" {...dragProps}>
        <span className="titlebar__title">
          {connected ? <span className="mono">{serverLabel}</span> : 'Squeal Editor'}
        </span>
      </div>

      <div className="titlebar__controls">
        <button className="titlebar__btn" onClick={minimize} aria-label="Minimise" title="Minimise">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>

        <button
          className="titlebar__btn"
          onClick={() => void toggleMaximize()}
          aria-label={maximized ? 'Restore' : 'Maximise'}
          title={maximized ? 'Restore' : 'Maximise'}
        >
          {maximized ? (
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
          )}
        </button>

        <button
          className="titlebar__btn titlebar__btn--close"
          onClick={close}
          aria-label="Close"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
