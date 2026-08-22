import type { TableInfo } from '../../../../shared/protocol/index.ts';

/**
 * A relation the UI is pointing at: what it is called, and where it lives.
 *
 * The two travel together everywhere a table's identity does -- a tab, a browsed
 * page, a cache key -- because the schema is a fact the extension reported and
 * not something to be read back out of a name later. A `TableInfo` is one of
 * these plus a `kind`.
 */
export interface Relation {
    table: string;
    /** Absent for MySQL, which has no schema layer, and for a name with no catalog row behind it. */
    schema?: string;
}

export const relationOf = ({ name, schema }: TableInfo): Relation => ({ table: name, schema });

/**
 * The key a relation is filed under: its full name, always qualified.
 *
 * Derived from the fields, which is the safe direction -- going the other way,
 * recovering a schema by splitting on a dot, is the guess this whole shape
 * exists to remove, and nothing here does it. Unconditional because a key must
 * be unambiguous: two schemas may each hold a `users`, and a key that dropped
 * the common one would file them both under the same entry.
 */
export const relationName = ({ table, schema }: Relation): string =>
    schema ? `${schema}.${table}` : table;

/**
 * How a relation reads on screen, with the schema that goes without saying left
 * off.
 *
 * Deliberately *not* `relationName`: a key must be unambiguous and a label must
 * be readable, and those pull apart exactly on the default schema. Printing
 * `public.` on every row of an ordinary Postgres database is noise about the
 * case that never needed saying.
 *
 * `defaultSchema` comes from the session, which got it from the driver -- the
 * UI does not know that Postgres calls its default `public`, the same way it
 * does not know which dialect Postgres highlights as. Undefined means nothing
 * goes without saying, so everything is spelled out.
 */
export const relationLabel = (relation: Relation, defaultSchema?: string): string =>
    relation.schema !== undefined && relation.schema === defaultSchema
        ? relation.table
        : relationName(relation);

/**
 * Fill in the schema of a relation named without one, from the relations the
 * catalog already listed.
 *
 * Everything that comes from the tree carries its schema and returns unchanged.
 * The caller that cannot is the editor's completion: it scans a name out of SQL
 * being typed, so all it has is the text. Matching that text against the listed
 * relations is a *lookup* rather than the split-on-a-dot guess this design
 * removed -- and it is what keeps one table filed under one key no matter which
 * of the two asked about it, which is what makes expanding a row in the tree
 * warm the cache the popup reads.
 *
 * A name matching nothing is left exactly as typed. The user may be mid-word, or
 * naming a relation this database never listed; inventing a schema for it would
 * be the guess coming back in through the side door.
 */
export function resolveRelation(listed: TableInfo[] | undefined, ref: Relation): Relation {
    if (ref.schema !== undefined) return ref;
    const match = listed?.find(
        (t) => t.name === ref.table || relationName(relationOf(t)) === ref.table,
    );
    return match ? relationOf(match) : ref;
}
