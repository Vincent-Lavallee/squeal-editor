import Button from '../../common/components/Button.tsx';
import BannerShell from './BannerShell.tsx';

export default function UpToDateBanner({ dismiss }: { dismiss: () => void }) {
    return (
        <BannerShell>
            <span style={{ marginRight: 'auto' }}>You&apos;re on the latest version.</span>
            <Button variant="ghost" onClick={dismiss}>
                Dismiss
            </Button>
        </BannerShell>
    );
}
