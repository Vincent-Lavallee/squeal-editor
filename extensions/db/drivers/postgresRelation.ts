import type { Relation } from './driver.ts';

/**
 * Where a relation lives and what it is called, for a caller that supplied only a
 * name.
 *
 * `listTables` reports the schema as a field, so everything that comes from the
 * tree -- browsing, columns, the definition, a drop, a write-back -- arrives with
 * both halves already and never reaches the fallback below. The one caller that
 * cannot is the editor's completion: it scans a relation out of SQL *being
 * typed*, where `reporting.hits` is a string the user wrote and there is no
 * catalog row behind it to ask.
 *
 * So the split is a guess, and it is confined to the only case where guessing is
 * the sole option available. It splits on the *first* dot and reads an
 * unqualified name as `public`, which is right for every name a user is likely to
 * type and wrong for a table with a dot in its own name -- a relation the tree
 * addresses correctly, because there the schema is a field rather than something
 * recovered from punctuation.
 */
export function splitRelation({ schema, table }: Relation): { schema: string; relation: string } {
    if (schema !== undefined) return { schema, relation: table };
    const dot = table.indexOf('.');
    return dot === -1
        ? { schema: 'public', relation: table }
        : { schema: table.slice(0, dot), relation: table.slice(dot + 1) };
}
