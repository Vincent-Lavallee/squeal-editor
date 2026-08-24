import { useCallback } from 'react';

import { call } from '../../../../common/bridge/bridge.ts';

/**
 * What the About menu knows about the running app.
 *
 * `version` is `__APP_VERSION__`, the build-time constant the updater already
 * checks against -- the same value from the same place, so the number the dialog
 * shows and the number the release check compares cannot drift.
 *
 * Like `useWindowChrome`, this reaches the bridge without a thunk: there is no
 * result to keep and nothing to say when the folder will not open, so a slice
 * for it would hold nothing.
 */
export function useAbout() {
    const openDataDir = useCallback((): void => {
        void (async () => {
            const { path } = await call('app.dataDir', {});
            await Neutralino.os.open(path);
        })().catch(() => undefined);
    }, []);

    return { version: __APP_VERSION__, openDataDir };
}
