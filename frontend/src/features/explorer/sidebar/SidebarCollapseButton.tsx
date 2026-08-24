import Button from '../../../common/components/Button.tsx';
import { SidebarFoldIcon, SidebarUnfoldIcon } from '../../../common/icons/icons.ts';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}

export default function SidebarCollapseButton({ collapsed, onToggleCollapse }: Props) {
    return (
        <Button
            variant="ghost"
            style={{
                justifyContent: 'center',
                flex: 'none',
                width: 24,
                height: 24,
                padding: 0,
                ...(collapsed ? { marginLeft: 0 } : { marginLeft: 'auto' }),
            }}
            onClick={onToggleCollapse}
            title={collapsed ? 'Show sidebar (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'}
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
            {collapsed ? (
                <SidebarUnfoldIcon style={iconSvg} aria-hidden="true" />
            ) : (
                <SidebarFoldIcon style={iconSvg} aria-hidden="true" />
            )}
        </Button>
    );
}
