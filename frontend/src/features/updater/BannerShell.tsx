import { UpdateIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16, color: t.ACCENT };

export default function BannerShell({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_SM,
                flex: 'none',
                padding: `${t.GAP_XS}px ${t.GAP}px`,
                borderBottom: `1px solid ${t.BORDER}`,
                color: t.TEXT,
                fontSize: t.TEXT_BADGE,
            }}
            role="status"
        >
            <UpdateIcon style={iconSvg} />
            {children}
        </div>
    );
}
