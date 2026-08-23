import {
    beginWindowResize,
    fitMaximizedToWorkArea,
    installWindowChrome,
    matchWindowFrame,
} from './chrome.ts';
import type { Handlers } from './commandTypes.ts';

/* eslint-disable @typescript-eslint/require-await -- Handlers requires every
   command to return a Promise so the dispatcher can await them uniformly; not
   every handler happens to need one. */
export function commandsWindow(): Pick<
    Handlers,
    'window.matchFrame' | 'window.fitMaximized' | 'window.installChrome' | 'window.beginResize'
> {
    return {
        async 'window.matchFrame'({ pid, colour }) {
            return { applied: matchWindowFrame(pid, colour) };
        },

        async 'window.fitMaximized'({ pid }) {
            return { applied: fitMaximizedToWorkArea(pid) };
        },

        async 'window.installChrome'({ pid }) {
            return { applied: installWindowChrome(pid) };
        },

        async 'window.beginResize'({ pid, edge }) {
            return { applied: beginWindowResize(pid, edge) };
        },
    };
}
/* eslint-enable @typescript-eslint/require-await */
