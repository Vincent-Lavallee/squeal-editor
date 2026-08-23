import Button from '../../common/components/Button.tsx';
import BannerShell from './BannerShell.tsx';

export default function CheckFailedBanner({
    check,
    dismiss,
}: {
    check: () => void;
    dismiss: () => void;
}) {
    return (
        <BannerShell>
            <span style={{ marginRight: 'auto' }}>Couldn&apos;t check for updates.</span>
            <Button onClick={check}>Try again</Button>
            <Button variant="ghost" onClick={dismiss}>
                Dismiss
            </Button>
        </BannerShell>
    );
}
