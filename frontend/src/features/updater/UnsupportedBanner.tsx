import Button from '../../common/components/Button.tsx';
import BannerShell from './BannerShell.tsx';

export default function UnsupportedBanner({ dismiss }: { dismiss: () => void }) {
    return (
        <BannerShell>
            <span style={{ marginRight: 'auto' }}>
                Automatic updates aren&apos;t available on this platform yet.
            </span>
            <Button variant="ghost" onClick={dismiss}>
                Dismiss
            </Button>
        </BannerShell>
    );
}
