import { UpdateIcon } from '../../icons.ts';
import { useUpdater } from './useUpdater.ts';

/**
 * The one strip that carries an update, under the titlebar.
 *
 * It never blocks: the whole flow is user-initiated, so this is a banner you can
 * wave away, not a modal that stops the app. It obeys the design system -- one
 * background, a single 1px rule under it, the accent only on the primary action;
 * no shadow, no lighter surface.
 *
 * The download bar is determinate only when the server sent a length; otherwise
 * `totalBytes` is 0 and it shows the indeterminate stripe rather than lying
 * about a percentage.
 */
export default function UpdateBanner() {
  const { phase, status, progress, dismissed, upToDate, checkFailed, error, check, download, apply, dismiss } =
    useUpdater();

  // A manual check that could not reach the releases: say so, rather than
  // claiming you are current when we never found out.
  if (checkFailed) {
    return (
      <div className="update-banner" role="status">
        <UpdateIcon className="icon" />
        <span className="update-banner__msg">Couldn't check for updates.</span>
        <button type="button" className="btn" onClick={() => check(true)}>
          Try again
        </button>
        <button type="button" className="btn btn--ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  // A manual check that found nothing: a small, dismissible acknowledgement.
  if (upToDate) {
    return (
      <div className="update-banner" role="status">
        <UpdateIcon className="icon" />
        <span className="update-banner__msg">You're on the latest version.</span>
        <button type="button" className="btn btn--ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  // Everything else hangs off a found update; nothing to show without one.
  if (!status?.hasUpdate || dismissed) return null;
  const version = status.latestVersion;

  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
      : null;

  return (
    <div className="update-banner" role="status">
      <UpdateIcon className="icon" />

      {phase === 'downloading' ? (
        <>
          <span className="update-banner__msg">Downloading Squeal {version}…</span>
          <div
            className={`update-banner__bar ${percent === null ? 'update-banner__bar--indeterminate' : ''}`}
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="update-banner__fill" style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
          {percent !== null && <span className="update-banner__pct mono">{percent}%</span>}
        </>
      ) : phase === 'ready' ? (
        <>
          <span className="update-banner__msg">Squeal {version} is ready to install.</span>
          <button type="button" className="btn btn--primary" onClick={apply}>
            Restart to update
          </button>
          <button type="button" className="btn btn--ghost" onClick={dismiss}>
            Later
          </button>
        </>
      ) : phase === 'error' ? (
        <>
          <span className="update-banner__msg update-banner__msg--error">
            {error ?? 'The update could not be installed.'}
          </span>
          <button type="button" className="btn" onClick={download}>
            Try again
          </button>
          <button type="button" className="btn btn--ghost" onClick={dismiss}>
            Dismiss
          </button>
        </>
      ) : (
        <>
          <span className="update-banner__msg">Squeal {version} is available.</span>
          <button type="button" className="btn btn--primary" onClick={download}>
            Download
          </button>
          <button type="button" className="btn btn--ghost" onClick={dismiss}>
            Later
          </button>
        </>
      )}
    </div>
  );
}
