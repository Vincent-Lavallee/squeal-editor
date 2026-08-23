import Button from '../../common/components/Button.tsx';

export default function ReadyToInstall({
    version,
    apply,
    dismiss,
}: {
    version: string | null;
    apply: () => void;
    dismiss: () => void;
}) {
    return (
        <>
            <span style={{ marginRight: 'auto' }}>Squeal {version} is ready to install.</span>
            <Button variant="primary" onClick={apply}>
                Restart to update
            </Button>
            <Button variant="ghost" onClick={dismiss}>
                Later
            </Button>
        </>
    );
}
