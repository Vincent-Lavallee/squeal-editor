import type { DiagramTable, ForeignKeyRef } from '../../../shared/protocol/index.ts';

/** One column's membership in one index, as the catalog reports it. */
export interface KeyPart {
    index: string;
    /** Null for a functional/expression index column, which cannot be a plain key. */
    column: string | null;
    primary: boolean;
    unique: boolean;
    nullable: boolean;
}

/**
 * Picks a table's row-identity columns out of its index catalog: the primary
 * key, else the first unique index whose every column is present and `NOT NULL`.
 *
 * A nullable unique column is rejected on purpose -- two rows may both be NULL
 * there, so a `WHERE` over it is not a single-row target. Shared by every engine
 * so "what counts as an identity" has one answer; each driver only has to shape
 * its catalog rows into `KeyPart`s, ordered within an index by key position.
 */
export function pickRowKey(parts: KeyPart[]): string[] | null {
    const byIndex = new Map<string, KeyPart[]>();
    for (const p of parts) {
        const list = byIndex.get(p.index) ?? [];
        list.push(p);
        byIndex.set(p.index, list);
    }
    const usable = (cols: KeyPart[]) =>
        cols.length > 0 && cols.every((c) => c.column !== null && !c.nullable);

    for (const cols of byIndex.values()) {
        if (cols[0]!.primary && usable(cols)) return cols.map((c) => c.column as string);
    }
    for (const cols of byIndex.values()) {
        if (!cols[0]!.primary && cols.every((c) => c.unique) && usable(cols)) {
            return cols.map((c) => c.column as string);
        }
    }
    return null;
}

/** One column's participation in one foreign-key constraint, as the catalog reports it. */
export interface FkPart {
    constraint: string;
    column: string;
    /** Absent for MySQL, whose database is its schema. */
    refSchema?: string;
    refTable: string;
    /** Null for SQLite's column-less `REFERENCES parent`, before the caller resolves it. */
    refColumn: string | null;
}

/**
 * Picks the single-column foreign keys out of a table's constraint catalog,
 * keyed by the local column name.
 *
 * Shared for `pickRowKey`'s reason: the grouping must not drift per engine, and
 * each driver only has to shape its own catalog rows into `FkPart`s.
 *
 * **A composite constraint is dropped, not reported on its first column.** A
 * cell holds one value; navigating on it alone would filter the related table by
 * a fraction of the key and land on every row sharing that fraction, silently --
 * the same class of wrong answer `pickRowKey` refuses a nullable unique column
 * for. `ForeignKeyRef` documents this as the reason it exists at all.
 */
export function pickForeignKeys(parts: FkPart[]): Map<string, ForeignKeyRef> {
    const byConstraint = new Map<string, FkPart[]>();
    for (const p of parts) {
        const list = byConstraint.get(p.constraint) ?? [];
        list.push(p);
        byConstraint.set(p.constraint, list);
    }

    const result = new Map<string, ForeignKeyRef>();
    for (const cols of byConstraint.values()) {
        if (cols.length !== 1) continue;
        const p = cols[0]!;
        if (p.refColumn === null) continue;
        result.set(p.column, { table: p.refTable, schema: p.refSchema, column: p.refColumn });
    }
    return result;
}

/** One column of one table, as a whole-database catalog read reports it. */
export interface DiagramColumnPart {
    table: string;
    /** Absent for an engine whose database is its schema. */
    schema?: string;
    name: string;
    dataType: string;
    primaryKey: boolean;
}

/** One column's place in one foreign key, as that same read reports it. */
export interface DiagramLinkPart {
    table: string;
    schema?: string;
    constraint: string;
    column: string;
    refSchema?: string;
    refTable: string;
    refColumn: string;
}

/**
 * Two facts identify a relation, so both are in the key -- never a joined name.
 *
 * Encoded rather than joined on a separator, because there is no character an
 * identifier cannot contain: a dot files `"a.b"."c"` and `"a"."b.c"` under one
 * key, which is the exact guess `Relation` exists to remove, and a quoted name
 * may hold a space just as easily. The format is this file's business alone --
 * both maps are local to `assembleDiagram` and no caller ever sees a key.
 */
const relationKey = (schema: string | undefined, table: string): string =>
    JSON.stringify([schema ?? '', table]);

/**
 * Folds a database's flat column and constraint rows into one node per table.
 *
 * Shared for `pickRowKey`'s reason: the grouping must not drift per engine, and
 * each driver only has to shape its own catalog rows into these two lists.
 * Column order and key order are the queries' -- both are asked for ordered, and
 * nothing here re-sorts them.
 *
 * **A composite constraint survives here, where `pickForeignKeys` drops it.**
 * That one is answering for a *cell* and a cell holds one value, so a fraction
 * of a key is a wrong answer. A line between two tables is not a fraction of
 * anything: the tables really are related, and dropping the constraint would
 * draw them as strangers.
 *
 * **A constraint whose target is not among these tables is dropped**, since a
 * line has to end somewhere the diagram is drawing. That is a cross-database
 * foreign key on MySQL, or one into a schema the column read did not cover.
 */
export function assembleDiagram(
    columns: DiagramColumnPart[],
    links: DiagramLinkPart[],
): DiagramTable[] {
    const tables = new Map<string, DiagramTable>();
    for (const part of columns) {
        const key = relationKey(part.schema, part.table);
        let table = tables.get(key);
        if (!table) {
            table = { name: part.table, schema: part.schema, columns: [], foreignKeys: [] };
            tables.set(key, table);
        }
        table.columns.push({
            name: part.name,
            dataType: part.dataType,
            primaryKey: part.primaryKey,
        });
    }

    const byConstraint = new Map<string, DiagramLinkPart[]>();
    for (const part of links) {
        // The constraint name is scoped to its table on every engine here, so the
        // table is in the key -- two tables may each carry a `fk_owner`.
        const key = JSON.stringify([part.schema ?? '', part.table, part.constraint]);
        const parts = byConstraint.get(key) ?? [];
        parts.push(part);
        byConstraint.set(key, parts);
    }

    for (const parts of byConstraint.values()) {
        const first = parts[0]!;
        const source = tables.get(relationKey(first.schema, first.table));
        if (!source || !tables.has(relationKey(first.refSchema, first.refTable))) continue;
        source.foreignKeys.push({
            name: first.constraint,
            columns: parts.map((part) => part.column),
            refTable: first.refTable,
            refSchema: first.refSchema,
            refColumns: parts.map((part) => part.refColumn),
        });
    }

    return [...tables.values()];
}
