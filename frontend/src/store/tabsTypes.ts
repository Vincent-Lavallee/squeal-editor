import type { TableFilter } from '../../../shared/protocol/index.ts';

/**
 * What is open, and what each one is pointed at.
 *
 * Two kinds, because a table opened from the tree has no query to write: an
 * `editor` tab is an editor with its result grid beneath it, a `grid` tab is the
 * grid alone. Both render the same grid, so one place still knows how a row
 * looks.
 */
export interface Tab {
    id: string;
    /**
     * Which connection this tab runs against, and it never changes.
     *
     * A tab used to take the session's word for it, back when there was only one
     * session to take. With a rail, that would mean a tab left on dev running
     * against prod the moment you moved the rail -- the tab looks identical, the
     * server underneath it is not. So the tab carries its own, and every thunk
     * reads it from here rather than from whichever connection is in front.
     */
    connectionId: string;
    /**
     * Which database *this tab* runs against, independent of every other tab of
     * the same connection.
     *
     * The connection holds one seed value (`defaultDatabase`) and nothing else:
     * this is the only thing `runQuery`, `browseTable` and `saveEdits` ever read,
     * so there is one answer to "where does this run" and it belongs to the tab
     * that runs it. A tab is born on whatever the tab in front was on, so an
     * ordinary session never diverges -- pointing a tab somewhere else is a
     * deliberate act, which is what keeps the tree following this value legible
     * rather than surprising. See `docs/decisions.md`.
     *
     * `null` only while the connection reported no databases at all.
     */
    database: string | null;
    /**
     * A `diagram` tab is the third kind and the thinnest: it holds nothing but
     * the database it is about, which `Tab.database` already carries. It has no
     * text to save, no rows to browse and nothing keyed by its id anywhere --
     * which is what made it cheap enough to be a tab at all. See
     * `docs/decisions.md`.
     *
     * An `assistant` tab holds no database either, and **is** a conversation
     * rather than a window onto one -- several may be open, each with its own
     * thread, which is why `openAssistantTab` mints like every other `open*Tab`.
     * It is a tab and not a panel because the thing it draws wants the room a pane
     * has, and because everything the app already knows about opening, closing,
     * splitting and reordering then applies to it for free. See
     * `docs/decisions.md`.
     */
    kind: 'editor' | 'grid' | 'diagram' | 'assistant';
    /** Which table a `grid` tab is browsing. Absent on an `editor` tab. */
    table?: string;
    /**
     * The schema that table lives in, carried beside the name for the life of the
     * tab rather than parsed back out of it when the tab re-browses. Absent for
     * MySQL, which has no schema layer.
     */
    schema?: string;
    /**
     * A grid tab's filter *seed*: the `WHERE` a restored tab should re-browse with
     * on first view. It is consumed once, by that first browse -- after which
     * `results[tabId].browse.filter` is authoritative and this is never read again.
     * Absent for a tab opened fresh (which browses imperatively) and for editor
     * tabs. This exists only so a lazily-restored grid tab, which has no `browse`
     * yet, still knows the filter it was reopened with. See `docs/frontend.md`.
     */
    filter?: TableFilter;
    /**
     * Stored at open time rather than derived from position. Numbering the editor
     * tabs by index renumbers the survivors when one closes -- close Query 1 and
     * Query 2 silently becomes Query 1, renaming a tab the user never touched.
     */
    title: string;
    /**
     * The saved query this editor tab is the open copy of, if it is one.
     *
     * This is what makes Ctrl+S mean *save* rather than *save another copy*: a
     * linked tab writes over the row it came from and never asks for a name again.
     * Absent for a blank query tab, for a definition tab, and for every grid tab,
     * none of which came from anywhere.
     */
    savedQueryId?: string;
    /**
     * An assistant tab's conversation *seed*: the stored thread a restored tab
     * should be reopened holding.
     *
     * The grid filter's shape exactly, and for its reason. It is written only by
     * the session restore below and read once, by the panel adopting it -- from
     * then on `assistant.byTab[tabId].id` is the live answer, and the serialiser
     * reads that one for a tab that has been looked at and this seed for one that
     * has not. Nothing writes it back, so the two cannot drift.
     *
     * It is the exception to "runtime ids are left out of a snapshot" that
     * `savedQueryId` already is: a conversation's id is the store's and outlives
     * every session, which is exactly why the link can be written down.
     */
    conversationId?: string;
    /**
     * Whether closing *this tab* would destroy text that exists nowhere else.
     *
     * Two shapes of that, and the flag is deliberately one field for both: a tab
     * linked to a saved query whose text has drifted from it, and a tab linked to
     * nothing at all that has been typed into. Closing either loses work --
     * `tabsClosed` deletes the tab's `sqlByTab` entry and the session listener then
     * writes a snapshot without it -- which is why one flag answers both the dot in
     * the strip and the confirm on close.
     *
     * A flag rather than a comparison against the stored query's text, and the
     * difference is the whole of what it means. Comparing said "this text is not
     * what is on disk", which is a fact about the query and therefore true of
     * **every** tab holding it: saving one copy lit the mark on every other copy,
     * and deleting the query lit it on all of them at once, in both cases about an
     * edit the user had not made there. The mark is about the tab, so the tab is
     * what carries it. See `docs/decisions.md`.
     *
     * It is what makes seeding a tab at birth (`tabOpened`'s `sql`) rather than
     * through a `sqlChanged` load-bearing: a definition tab is generated text
     * nobody typed, and marking it would ask about work that is one click away
     * from being regenerated.
     */
    unsaved?: boolean;
    /**
     * Which pane this tab is docked in.
     *
     * A tab is born into the pane whose control opened it -- each strip has its
     * own `+` and bookmark, and a control belonging to no pane (the tree) opens
     * into the one being worked in. It used to be `'primary'` at birth always,
     * with dragging the only way into `'secondary'`; that made the secondary
     * strip a place you could only ever move work *to*, which is what left it
     * without a `+` or a bookmark of its own. See `docs/decisions.md`.
     *
     * It rides in the session snapshot, so a connection reopens split the way it
     * was left. See *Split the editor* in `docs/frontend.md`.
     */
    pane: 'primary' | 'secondary';
}

/**
 * A close gesture, before it is a set of tabs. `closeIdsFor` turns one into the
 * ids it would take, which is what lets a close be counted and then confirmed
 * before anything is dispatched.
 */
export type CloseIntent =
    | { kind: 'one'; id: string }
    | { kind: 'others'; id: string }
    | { kind: 'right'; id: string }
    | { kind: 'all'; pane: Tab['pane'] };
