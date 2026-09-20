import type { Relation } from '../driver.ts';

/**
 * Where a relation lives and what it is called, for a caller that supplied only
 * a name -- the same fallback `postgres/relation.ts` is, for the same one
 * caller: the editor's completion, scanning a relation out of SQL *being
 * typed*, where there is no catalog row behind it to ask.
 *
 * `dbo` is SQL Server's own default schema, the one a bare unqualified name
 * resolves to unless a user's default schema says otherwise -- the same
 * convention `defaultSchema` on the driver reports to the UI.
 */
export function splitRelation({ schema, table }: Relation): { schema: string; relation: string } {
    if (schema !== undefined) return { schema, relation: table };
    const dot = table.indexOf('.');
    return dot === -1
        ? { schema: 'dbo', relation: table }
        : { schema: table.slice(0, dot), relation: table.slice(dot + 1) };
}
