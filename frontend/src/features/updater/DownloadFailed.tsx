import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';

export default function DownloadFailed({
    error,
    download,
    dismiss,
}: {
    error: string | null;
    download: () => void;
    dismiss: () => void;
}) {
    return (
        <>
            <span style={{ marginRight: 'auto', color: t.RED_TEXT }}>
                {error ?? 'The update could not be installed.'}
            </span>
            <Button onClick={download}>Try again</Button>
            <Button variant="ghost" onClick={dismiss}>
                Dismiss
            </Button>
        </>
    );
}
