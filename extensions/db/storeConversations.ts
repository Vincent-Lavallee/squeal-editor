import type { AiConversation, AiConversationSummary } from '../../shared/protocol/index.ts';
import { open } from './storeCore.ts';

/**
 * Every kept conversation, newest first, **without its body**.
 *
 * The body is left out because of what it is: a transcript carries the schema
 * dumps and DDL the model read, so answering with all of them would read every
 * conversation ever had off disk to draw a dozen rows. `getConversation` fetches
 * the one that was picked.
 */
export function listConversations(): AiConversationSummary[] {
    return open()
        .query(
            'SELECT id, title, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC',
        )
        .all() as AiConversationSummary[];
}

/** One conversation, or null for an id no row answers to -- see `conversations.get`. */
export function getConversation(id: string): AiConversation | null {
    return open()
        .query('SELECT id, title, updated_at AS updatedAt, body FROM conversations WHERE id = ?')
        .get(id) as AiConversation | null;
}

/**
 * Write a conversation, replacing whatever was under that id.
 *
 * The id is the caller's, unlike `saveQuery`'s: a thread is written on a
 * debounce while it is still being had, so a store that minted one would make
 * the first two saves of a single conversation two rows.
 *
 * The clock is this side's, so the list has one thing ordering it. Epoch
 * milliseconds is our own bookkeeping and nothing a server sent — the rule that
 * keeps values away from JS numbers is about the other kind.
 */
export function saveConversation({
    id,
    title,
    body,
}: {
    id: string;
    title: string;
    body: string;
}): number {
    const updatedAt = Date.now();
    open().run(
        `INSERT INTO conversations (id, title, updated_at, body) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at, body = excluded.body`,
        [id, title, updatedAt, body],
    );
    return updatedAt;
}

export function deleteConversation(id: string): void {
    open().run('DELETE FROM conversations WHERE id = ?', [id]);
}
