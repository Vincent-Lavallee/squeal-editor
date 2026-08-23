import Button from '../../common/components/Button.tsx';

export default function UpdateAvailable({
    version,
    download,
    dismiss,
}: {
    version: string | null;
    download: () => void;
    dismiss: () => void;
}) {
    return (
        <>
            <span style={{ marginRight: 'auto' }}>Squeal {version} is available.</span>
            <Button variant="primary" onClick={download}>
                Download
            </Button>
            <Button variant="ghost" onClick={dismiss}>
                Later
            </Button>
        </>
    );
}
