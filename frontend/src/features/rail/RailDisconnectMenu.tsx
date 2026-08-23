import ContextMenu from '../../common/components/ContextMenu.tsx';

interface Props {
    connectionId: string;
    x: number;
    y: number;
    onClose: () => void;
    onDisconnect: (connectionId: string) => void;
}

// No confirmation, unlike closing a tab: `disconnect.pending` saves the
// session while the tabs still exist, so reconnecting brings back the
// tabs, the split and the queries. It parks work; it does not destroy it.
export default function RailDisconnectMenu({ connectionId, x, y, onClose, onDisconnect }: Props) {
    return (
        <ContextMenu
            x={x}
            y={y}
            onClose={onClose}
            items={[
                {
                    label: 'Disconnect',
                    danger: true,
                    onSelect: () => onDisconnect(connectionId),
                },
            ]}
        />
    );
}
