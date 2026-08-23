import Button from '../../common/components/Button.tsx';
import { RefreshIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconStyle = { flex: 'none', width: t.ICON, height: t.ICON } as const;

// Last, after the zoom group: the sidebar's own icon and its spin while the
// read is in flight, so a refresh that changes nothing still says it happened.
export default function RefreshButton({
    loading,
    disabled,
    onRefresh,
    refreshChord,
}: {
    loading: boolean;
    disabled: boolean;
    onRefresh: () => void;
    refreshChord: string;
}) {
    return (
        <Button
            variant="ghost"
            style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0 }}
            onClick={onRefresh}
            disabled={disabled}
            title={`Read the schema again (${refreshChord})`}
            aria-label="Refresh the diagram"
            data-testid="diagram-refresh"
        >
            <RefreshIcon
                className={loading ? 'spin' : undefined}
                style={iconStyle}
                aria-hidden="true"
            />
        </Button>
    );
}
