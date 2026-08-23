/**
 * Everything else the store keeps that is not about any one connection:
 * workspaces (the thing connections hang off), environments (the picklist
 * connections tag with), saved queries, assistant conversations, and user
 * settings.
 */

import type { EnvironmentDef, Workspace, WorkspaceIconId } from '../config.ts';
import type { AiConversation, AiConversationSummary } from '../ai.ts';
import type { SavedQuery } from '../queries.ts';

export interface StoreCommands {
    'db.workspaces.list': {
        req: Record<string, never>;
        res: { workspaces: Workspace[] };
    };
    /** Omit `id` to add; pass one to update it in place. */
    'db.workspaces.save': {
        req: { id?: string; name: string; icon: WorkspaceIconId };
        res: { workspace: Workspace };
    };
    /**
     * Deletes the workspace *and every connection in it* -- the UI confirms
     * against a count before asking, because this takes stored passwords with it.
     *
     * The last workspace is refused: connections hang off a workspace, so an app
     * with none has nowhere to save one and no way back.
     */
    'db.workspaces.delete': {
        req: { id: string };
        res: { ok: true };
    };

    /**
     * The managed list of environment names, in display order -- what
     * `ConnectionForm`'s "Environment" select offers and what `SavedConnectionList`
     * groups by. Not the environments actually in use: a connection stores its
     * environment as plain text (see `Environment`), so a name removed from here
     * can still sit on existing connections, unreachable through this list alone.
     */
    'db.environments.list': {
        req: Record<string, never>;
        res: { environments: EnvironmentDef[] };
    };
    /** Appends a new environment at the end of the list. No rename: the list is add/remove only. */
    'db.environments.add': {
        req: { name: string };
        res: { environment: EnvironmentDef };
    };
    /**
     * Removes an environment from the list. Connections already carrying its name
     * are untouched -- there is no foreign key to cascade, because the point of
     * "removed from the list" is that it stops being offered, not that it stops
     * having been true of a connection.
     *
     * The last environment is refused, the same guard as the last workspace: the
     * connect form needs at least one to offer a new connection.
     */
    'db.environments.remove': {
        req: { id: string };
        res: { ok: true };
    };

    /**
     * Every saved query, in the order the picker draws them: by name.
     *
     * There is no per-connection variant of this, because a saved query names no
     * connection -- see `SavedQuery`. The whole list is a handful of short strings
     * and is read once, the same call `settings.list` makes for the same reason.
     */
    'queries.list': {
        req: Record<string, never>;
        res: { queries: SavedQuery[] };
    };
    /**
     * Omit `id` to add; pass one to replace that query in place.
     *
     * `id` is what makes Ctrl+S mean *save* rather than *save another copy*: a tab
     * opened from a saved query carries the id it came from, so pressing it again
     * writes over the same row instead of asking for a name a second time.
     *
     * Rejects on a name another query already holds, rather than filing a second
     * one nothing can tell apart, and on an `id` that no longer names a row --
     * re-creating a deleted query under its old id would undo a deliberate delete.
     */
    'queries.save': {
        req: { id?: string; name: string; sql: string };
        res: { query: SavedQuery };
    };
    'queries.delete': {
        req: { id: string };
        res: { ok: true };
    };

    /**
     * Every kept conversation, newest first, **without its body**.
     *
     * These are `conversations.*` rather than `ai.*` because the half of the
     * extension that answers them is `store.ts` and not `assistant.ts`: a stored
     * thread is text on disk about nobody's server, the same category
     * `queries.*` and `settings.*` are in. `ai.*` is the provider — the key, the
     * catalog, one turn — and none of that is involved in reading a transcript
     * back.
     *
     * The bodies are left out for the reason `settings.list` includes everything:
     * the shape of the data decides. A setting is a short string and a transcript
     * is not, so this answers what the picker draws and `conversations.get`
     * fetches the one that was picked.
     */
    'conversations.list': {
        req: Record<string, never>;
        res: { conversations: AiConversationSummary[] };
    };
    /**
     * One conversation with what was said in it, or `null` for an id that no
     * longer names a row.
     *
     * Null rather than a rejection, for `ai.status`'s reason: a tab can outlive
     * the conversation it was reopened from — deleted from the picker while the
     * tab sat behind it — and "there is nothing there" is an answer the panel
     * renders as an empty thread, not a failure of the asking.
     */
    'conversations.get': {
        req: { id: string };
        res: { conversation: AiConversation | null };
    };
    /**
     * Write a conversation, replacing whatever was under that id.
     *
     * The `id` is the UI's, minted when a thread gets its first message, unlike
     * `queries.save` where the store mints one. A conversation is written on a
     * debounce while it is still being had, so an id the caller does not hold yet
     * would make the first two saves of one thread two rows.
     *
     * `updatedAt` is answered rather than sent: it is what the list is ordered by,
     * and one clock deciding it is what stops two saves a second apart from being
     * ordered by whichever side's clock was consulted.
     */
    'conversations.save': {
        req: { id: string; title: string; body: string };
        res: { updatedAt: number };
    };
    'conversations.delete': {
        req: { id: string };
        res: { ok: true };
    };

    /**
     * Every stored setting, as one map, read once at launch.
     *
     * All of them rather than one per key: they are a handful of short strings, so
     * a call per setting buys nothing and makes the launch path grow a round trip
     * every time a preference is added. The UI holds the map and writes through.
     *
     * The value is a string and the *caller* owns its meaning -- the store keeps
     * text, not a schema of what each key may hold. A key nobody has written is
     * simply absent, which is what lets each reader spell its own default rather
     * than the store guessing one on behalf of a feature it knows nothing about.
     */
    'settings.list': {
        req: Record<string, never>;
        res: { settings: Record<string, string> };
    };
    /** Write one setting, inserting or replacing it. */
    'settings.set': {
        req: { key: string; value: string };
        res: { ok: true };
    };
}
