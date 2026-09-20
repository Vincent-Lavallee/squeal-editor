import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import * as t from '../tokens';
import { useTooltipPosition } from './hooks/useTooltipPosition.ts';

const SHOW_DELAY_MS = 300;

const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 50,
    padding: '4px 8px',
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
    color: t.TEXT,
    fontSize: t.TEXT_BADGE,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
};

interface Props {
    label: string;
    /** Suppresses the tooltip -- for a trigger that already has its own popup open. */
    disabled?: boolean;
    children: ReactElement;
}

/**
 * A hover label that shows in `SHOW_DELAY_MS`, well under the browser's own
 * ~1.5s `title` delay, and can actually be styled -- the two things a native
 * `title` cannot do.
 */
export default function Tooltip({ label, disabled, children }: Props) {
    const id = useId();
    const [visible, setVisible] = useState(false);
    const showTimer = useRef<ReturnType<typeof setTimeout>>();

    const clearShowTimer = () => {
        if (showTimer.current === undefined) return;
        clearTimeout(showTimer.current);
        showTimer.current = undefined;
    };

    const hide = () => {
        clearShowTimer();
        setVisible(false);
    };

    const show = () => {
        if (disabled) return;
        clearShowTimer();
        showTimer.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    useEffect(() => clearShowTimer, []);
    useEffect(() => {
        if (disabled) hide();
    }, [disabled]);

    const { triggerRef, tooltipRef, pos } = useTooltipPosition(visible, hide);

    return (
        <>
            <span
                ref={triggerRef}
                style={{ display: 'inline-flex' }}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
            >
                {cloneElement(children, { 'aria-describedby': visible ? id : undefined })}
            </span>
            {visible && (
                <div
                    ref={tooltipRef}
                    id={id}
                    role="tooltip"
                    style={{ ...tooltipStyle, top: pos.top, left: pos.left }}
                >
                    {label}
                </div>
            )}
        </>
    );
}
