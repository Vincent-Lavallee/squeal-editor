import { useUpdater } from './hooks/useUpdater.ts';
import BannerShell from './BannerShell.tsx';
import CheckFailedBanner from './CheckFailedBanner.tsx';
import DownloadFailed from './DownloadFailed.tsx';
import DownloadProgress from './DownloadProgress.tsx';
import ReadyToInstall from './ReadyToInstall.tsx';
import UnsupportedBanner from './UnsupportedBanner.tsx';
import UpdateAvailable from './UpdateAvailable.tsx';
import UpToDateBanner from './UpToDateBanner.tsx';

export default function UpdateBanner() {
    const {
        phase,
        status,
        progress,
        dismissed,
        upToDate,
        checkFailed,
        unsupported,
        error,
        check,
        download,
        apply,
        dismiss,
    } = useUpdater();

    // No "Try again": the answer is a property of the platform, not of the attempt.
    if (unsupported) return <UnsupportedBanner dismiss={dismiss} />;
    if (checkFailed) return <CheckFailedBanner check={() => check(true)} dismiss={dismiss} />;
    if (upToDate) return <UpToDateBanner dismiss={dismiss} />;

    if (!status?.hasUpdate || dismissed) return null;
    const version = status.latestVersion;
    const percent =
        progress && progress.totalBytes > 0
            ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
            : null;

    return (
        <BannerShell>
            {phase === 'downloading' ? (
                <DownloadProgress version={version} percent={percent} />
            ) : phase === 'ready' ? (
                <ReadyToInstall version={version} apply={apply} dismiss={dismiss} />
            ) : phase === 'error' ? (
                <DownloadFailed error={error} download={download} dismiss={dismiss} />
            ) : (
                <UpdateAvailable version={version} download={download} dismiss={dismiss} />
            )}
        </BannerShell>
    );
}
