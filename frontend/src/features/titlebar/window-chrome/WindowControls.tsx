import WindowControlButton from './WindowControlButton.tsx';

export default function WindowControls({
    maximized,
    minimize,
    toggleMaximize,
    close,
}: {
    maximized: boolean;
    minimize: () => void;
    toggleMaximize: () => Promise<void>;
    close: () => void;
}) {
    return (
        <div style={{ display: 'flex', flex: 'none', height: '100%' }}>
            <WindowControlButton name="minimize" maximized={maximized} onClick={minimize} />
            <WindowControlButton
                name="maximize"
                maximized={maximized}
                onClick={() => void toggleMaximize()}
            />
            <WindowControlButton name="close" maximized={maximized} onClick={close} />
        </div>
    );
}
