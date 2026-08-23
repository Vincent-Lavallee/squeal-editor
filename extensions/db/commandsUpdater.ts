import { UPDATE_PROGRESS_EVENT } from '../../shared/protocol/index.ts';
import { applyUpdate, checkForUpdate, downloadUpdate } from './updater.ts';
import type { Handlers, Send } from './commandTypes.ts';

export function commandsUpdater(
    send: Send,
): Pick<Handlers, 'update.check' | 'update.download' | 'update.apply'> {
    return {
        async 'update.check'({ currentVersion }) {
            return checkForUpdate(currentVersion);
        },

        async 'update.download'() {
            // Progress rides its own broadcast; this resolves only once staged + verified.
            await downloadUpdate((progress) => send(UPDATE_PROGRESS_EVENT, progress));
            return { ok: true };
        },

        async 'update.apply'() {
            // Resolves only once the swap is confirmed running; the UI exits on that.
            await applyUpdate();
            return { ok: true };
        },
    };
}
