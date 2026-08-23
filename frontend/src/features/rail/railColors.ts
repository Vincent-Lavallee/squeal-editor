import * as t from '../../common/tokens';

export const CHIP_BORDER_TINT = 0.3;
export const CHIP_WASH_TINT = 0.07;
export const ACTIVE_FILL_TINT = 0.72;

export function blendOverBg(fg: string, opacity: number): string {
    const r = parseInt(fg.slice(1, 3), 16);
    const g = parseInt(fg.slice(3, 5), 16);
    const b = parseInt(fg.slice(5, 7), 16);
    const bgR = parseInt(t.BG.slice(1, 3), 16);
    const bgG = parseInt(t.BG.slice(3, 5), 16);
    const bgB = parseInt(t.BG.slice(5, 7), 16);
    const lerp = (c: number, bgC: number) => Math.round(bgC + (c - bgC) * opacity);
    return `#${[lerp(r, bgR), lerp(g, bgG), lerp(b, bgB)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export function blendOver(fg: string, bg: string, opacity: number): string {
    const fgR = parseInt(fg.slice(1, 3), 16);
    const fgG = parseInt(fg.slice(3, 5), 16);
    const fgB = parseInt(fg.slice(5, 7), 16);
    const bgR = parseInt(bg.slice(1, 3), 16);
    const bgG = parseInt(bg.slice(3, 5), 16);
    const bgB = parseInt(bg.slice(5, 7), 16);
    const lerp = (c: number, bgC: number) => Math.round(bgC + (c - bgC) * opacity);
    return `#${[lerp(fgR, bgR), lerp(fgG, bgG), lerp(fgB, bgB)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
