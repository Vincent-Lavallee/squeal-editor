import * as t from '../../../common/tokens';

export default function MacosTitlebarTitle({
    connected,
    serverLabel,
    dragProps,
}: {
    connected: boolean;
    serverLabel: string;
    dragProps: React.HTMLAttributes<HTMLDivElement>;
}) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                minWidth: 0,
                height: '100%',
            }}
            {...dragProps}
        >
            <span
                style={{
                    overflow: 'hidden',
                    color: t.TEXT_MUTED,
                    fontSize: t.TEXT_BADGE,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {connected ? (
                    <span style={{ fontFamily: t.MONO }}>{serverLabel}</span>
                ) : (
                    'Squeal Editor'
                )}
            </span>
        </div>
    );
}
