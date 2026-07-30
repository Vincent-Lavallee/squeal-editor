/**
 * Statements the user asked to keep.
 *
 * Its own domain rather than a corner of `config` or `results`, because it is
 * neither: nothing here describes reaching a server, and nothing here came back
 * from one. A saved query is the app's own filing, and the one stored noun in
 * this contract that names no connection at all.
 */

/**
 * A named statement, reopenable into an editor tab on any connection.
 *
 * **Global, not scoped to a connection**, and that is the design rather than an
 * omission: the same statement is worth running against a dev box and a replica,
 * and filing it under one of them would mean saving it twice to use it twice. It
 * follows that a saved query knows nothing about a database, a schema or an
 * engine -- it is text, and where it runs is whichever tab it is opened into.
 *
 * `name` is unique across the store. The picker addresses a query by its name and
 * has nothing else to tell two apart with, unlike a connection, which carries a
 * colour and names a server; see `docs/extension.md`.
 */
export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
}
