import { useState } from 'react';

const DOT_SIZE = 12;
const DOT_GAP = 8;
const DOT_LEFT = 12;

const RED = '#ff5f57';
const YELLOW = '#febc2e';
const GREEN = '#28c840';

const RED_HOVER = '#c7352e';
const YELLOW_HOVER = '#d49a1e';
const GREEN_HOVER = '#1e9e30';

const RED_GLYPH = '#4d0000';
const YELLOW_GLYPH = '#8a5300';
const GREEN_GLYPH = '#0a4d0a';

const dotBase: React.CSSProperties = {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'block',
    padding: 0,
    flex: 'none',
};

// The viewBox is the size of the dot so a glyph is centered by its own
// coordinates. Art smaller than the dot puts half the stroke outside the
// viewBox, where the browser clips it by a different amount per glyph.
const glyph = (colour: string, d: string) => (
    <svg
        width={DOT_SIZE}
        height={DOT_SIZE}
        viewBox={`0 0 ${DOT_SIZE} ${DOT_SIZE}`}
        aria-hidden="true"
        style={{ display: 'block' }}
    >
        <path d={d} stroke={colour} strokeWidth="1.15" strokeLinecap="round" fill="none" />
    </svg>
);

const closeSymbol = glyph(RED_GLYPH, 'M4.2 4.2l3.6 3.6M7.8 4.2l-3.6 3.6');
const minimizeSymbol = glyph(YELLOW_GLYPH, 'M3.6 6h4.8');

// Deliberately not keyed on `maximized`: macOS swaps this glyph between
// fullscreen and zoom, not between zoomed and not, and this button is a zoom.
const zoomSymbol = (
    <svg
        width={DOT_SIZE}
        height={DOT_SIZE}
        viewBox={`0 0 ${DOT_SIZE} ${DOT_SIZE}`}
        aria-hidden="true"
        style={{ display: 'block' }}
    >
        <path d="M3.7 3.7h2.8l-2.8 2.8z M8.3 8.3h-2.8l2.8-2.8z" fill={GREEN_GLYPH} />
    </svg>
);

type DotName = 'close' | 'minimize' | 'zoom';

const dotLabel = (name: DotName, maximized: boolean): string =>
    name === 'close' ? 'Close' : name === 'minimize' ? 'Minimise' : maximized ? 'Restore' : 'Zoom';

/**
 * macOS-styled traffic-light buttons drawn on the left of a borderless window.
 *
 * The symbols are revealed by hovering the *group*, not the individual dot,
 * because that is what macOS does -- pointing at any one of the three lights
 * labels all three. Only the dot actually under the pointer takes the darker
 * shade.
 */
export default function TrafficLights({
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
    const [hovered, setHovered] = useState<DotName | null>(null);
    const [lightsHovered, setLightsHovered] = useState(false);

    const dot = (colour: string, hoverColour: string, name: DotName, symbol: React.ReactNode) => (
        <button
            key={name}
            style={{ ...dotBase, background: hovered === name ? hoverColour : colour }}
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered(null)}
            onClick={(e) => {
                e.stopPropagation();
                if (name === 'close') close();
                else if (name === 'minimize') minimize();
                else void toggleMaximize();
            }}
            aria-label={dotLabel(name, maximized)}
            title={dotLabel(name, maximized)}
        >
            {lightsHovered ? symbol : null}
        </button>
    );

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: DOT_GAP,
                flex: 'none',
                paddingLeft: DOT_LEFT,
            }}
            onMouseEnter={() => setLightsHovered(true)}
            onMouseLeave={() => {
                setLightsHovered(false);
                setHovered(null);
            }}
        >
            {dot(RED, RED_HOVER, 'close', closeSymbol)}
            {dot(YELLOW, YELLOW_HOVER, 'minimize', minimizeSymbol)}
            {dot(GREEN, GREEN_HOVER, 'zoom', zoomSymbol)}
        </div>
    );
}

export { DOT_GAP, DOT_LEFT, DOT_SIZE };
