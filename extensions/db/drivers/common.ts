import type {
  CellValue,
  ConnectionConfig,
  FilterOperator,
  ForeignKeyRef,
  RowDelete,
  RowEdit,
  SortOrder,
  TableFilter,
} from '../../../shared/protocol/index.ts';
// Amazon's published RDS CA bundle, folded into the compiled binary as text.
import rdsCaBundle from '../rds-global-bundle.pem' with { type: 'text' };

/**
 * How long an idle socket may stay quiet before it starts proving it is alive.
 *
 * Well under the ~350s an AWS network load balancer gives an idle connection
 * before it drops it without telling either end -- which is the shape of drop
 * this app cannot otherwise see coming, since a half-open socket looks exactly
 * like a healthy one until something is written to it.
 */
export const KEEPALIVE_DELAY_MS = 30_000;

/**
 * Result cells travel to the renderer as JSON, so anything the drivers hand back
 * that JSON.stringify would mangle (BigInt throws, Buffers become byte objects,
 * Dates lose their type) is flattened to a display string here.
 */
export function toDisplayValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  // bun:sqlite hands back a plain Uint8Array for a BLOB where mysql2 and pg hand
  // back a Buffer, and a Uint8Array falls through to the object arm below as
  // `{"0":137,"1":80,...}`. Both are byte arrays and both read as hex.
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export const toDisplayRow = (row: unknown[]): CellValue[] => row.map(toDisplayValue);

/**
 * Both engines' TLS options, written out rather than left to a default.
 *
 * `rejectUnauthorized` is stated even though true is what both libraries would
 * pick on their own: it is the entire meaning of the flag the user ticked, and a
 * default that flipped in a minor version would turn verified TLS into the
 * encrypted-but-unauthenticated channel `ServerConfig.ssl` promises it is not --
 * silently, and identically to how it is supposed to look when it works.
 *
 * Saying it here also means the two engines cannot drift apart on it, which is
 * the same reason quoting and dialects live in the drivers rather than the UI.
 */
const TLS_OPTIONS = { rejectUnauthorized: true } as const;

/**
 * The verified-TLS options for a connection, with the right trust anchor.
 *
 * A password connection may be reaching anything, so it verifies against the
 * machine's own trust store -- `TLS_OPTIONS` alone. An IAM connection reaches
 * RDS, whose certificate chains to Amazon's *own* CAs rather than a public root
 * that a default trust store carries -- so it fails with "unable to get local
 * issuer certificate" unless the RDS bundle is the anchor. `ca` here is the
 * complete chain to those roots, so an RDS cert verifies without weakening
 * anything: `rejectUnauthorized` stays on, it is the trusted set that changed,
 * not whether trust is checked. See `docs/decisions.md`.
 *
 * Only IAM gets the bundle: a non-IAM SSL connection to RDS is a case the user
 * can already meet by trusting the CA at the OS level, and quietly trusting
 * Amazon's roots for *every* SSL connection is a wider change than this is.
 */
export const tlsOptions = (config: ConnectionConfig) =>
  config.iam ? { rejectUnauthorized: true, ca: rdsCaBundle } : TLS_OPTIONS;

export const describeOk = (count: number) => `OK - ${count} row${count === 1 ? '' : 's'} affected`;

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
  const usable = (cols: KeyPart[]) => cols.length > 0 && cols.every((c) => c.column !== null && !c.nullable);

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

/**
 * Assembles and runs the parameterized `UPDATE`/`DELETE` statements for a batch
 * of edits and deletes, returning the total rows affected.
 *
 * Shared between the engines so the statement assembly and the more-than-one-row
 * guard cannot drift; the two things that differ are callbacks -- how a
 * placeholder is spelled (`?` vs `$n`) and how an affected-row count is read off
 * a result. The transaction around it is the caller's, because `BEGIN`/`COMMIT`
 * runs on the concrete client. Every value in `set` and `key` is bound as a
 * parameter, so the server parses the text and nothing is reformatted.
 */
export async function runWrites(
  // Already quoted and qualified by the driver's own `qualify`, so this assembler
  // never has to know how either is spelled -- the same shape as the two
  // callbacks below.
  qualified: string,
  keyColumns: string[],
  edits: RowEdit[],
  deletes: RowDelete[],
  quoteIdent: (name: string) => string,
  placeholder: (position: number) => string,
  exec: (sql: string, params: CellValue[]) => Promise<number>
): Promise<number> {
  const tooMany = (n: number, verb: string) =>
    new Error(`${verb} matched ${n} rows where one was expected -- the row's key is not unique.`);

  let affected = 0;
  for (const edit of edits) {
    const setCols = Object.keys(edit.set);
    // An edit that changes nothing has nothing to issue -- the UI should not send
    // one, but a no-op statement would be `SET  WHERE`, which is a syntax error.
    if (setCols.length === 0) continue;
    let p = 0;
    const set = setCols.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(', ');
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
    const params: CellValue[] = [...setCols.map((c) => edit.set[c] ?? null), ...keyColumns.map((c) => edit.key[c] ?? null)];
    const n = await exec(`UPDATE ${qualified} SET ${set} WHERE ${where}`, params);
    if (n > 1) throw tooMany(n, 'Edit');
    affected += n;
  }
  for (const del of deletes) {
    let p = 0;
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
    const params: CellValue[] = keyColumns.map((c) => del.key[c] ?? null);
    const n = await exec(`DELETE FROM ${qualified} WHERE ${where}`, params);
    if (n > 1) throw tooMany(n, 'Delete');
    affected += n;
  }
  return affected;
}

/** A `WHERE` clause and the values bound into it, ready to run. */
export interface WhereClause {
  /** The clause *without* the `WHERE` keyword, or null when nothing narrows. */
  clause: string | null;
  params: CellValue[];
}

/** The operators the builder may author, as a runtime guard over user JSON. */
const FILTER_OPERATORS = new Set<FilterOperator>([
  '=',
  '<>',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'IN',
  'IS NULL',
  'IS NOT NULL',
]);

const NO_VALUE_OPERATORS = new Set<FilterOperator>(['IS NULL', 'IS NOT NULL']);

/**
 * Turns a filter into the `WHERE` a browsed page runs under.
 *
 * Shared between the engines for `runWrites`' reason: the assembly and the
 * operator guard must not drift, and the only thing that differs is how a
 * placeholder is spelled. Quoting and the placeholder arrive as callbacks so
 * the per-engine halves stay in the engines' own files.
 *
 * **The builder path binds every value and interpolates none.** The column is
 * quoted, the operator comes from a closed set checked here rather than trusted
 * from the JSON, and the value becomes a parameter -- so a BIGINT compares
 * exactly, a date is the server's string to parse, and there is nothing for a
 * quote in the text to break out of. This is *Value handling* on the read path.
 *
 * **The raw path interpolates by design.** It is the user's own `WHERE` text,
 * the same category as the statement they type in the editor, and there is no
 * structure in it to bind. It is the escape hatch for what the operator set
 * cannot express, and it can express anything they could have written by hand.
 */
export function buildWhere(
  filter: TableFilter | undefined,
  quoteIdent: (name: string) => string,
  placeholder: (position: number) => string,
  startAt = 0
): WhereClause {
  const empty: WhereClause = { clause: null, params: [] };
  if (!filter) return empty;

  if (filter.kind === 'raw') {
    const where = filter.where.trim();
    return where ? { clause: where, params: [] } : empty;
  }

  const params: CellValue[] = [];
  let position = startAt;
  const parts: string[] = [];

  for (const condition of filter.conditions) {
    if (!condition.column) continue;
    if (!FILTER_OPERATORS.has(condition.operator)) {
      throw new Error(`Unsupported filter operator: ${String(condition.operator)}`);
    }
    const column = quoteIdent(condition.column);

    if (NO_VALUE_OPERATORS.has(condition.operator)) {
      parts.push(`${column} ${condition.operator}`);
      continue;
    }

    if (condition.operator === 'IN') {
      // One placeholder per item, so the list is bound rather than pasted. An
      // empty list has no rows it could match and no legal `IN ()` on either
      // engine, so the condition is dropped instead of authored as a syntax error.
      const items = condition.value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (items.length === 0) continue;
      const slots = items.map(() => placeholder(++position)).join(', ');
      params.push(...items);
      parts.push(`${column} IN (${slots})`);
      continue;
    }

    params.push(condition.value);
    parts.push(`${column} ${condition.operator} ${placeholder(++position)}`);
  }

  if (parts.length === 0) return empty;
  // Parenthesised per condition so an OR set cannot be re-associated by whatever
  // the caller appends next; the conjunction joins the whole set, and mixed
  // logic is the raw clause's job rather than something guessed at here.
  return { clause: parts.map((part) => `(${part})`).join(` ${filter.conjunction} `), params };
}

/** The directions a sort may take, as a runtime guard over user JSON. */
const SORT_DIRECTIONS = new Set<SortOrder['direction']>(['asc', 'desc']);

/**
 * Turns a sort into the `ORDER BY` a result comes back under.
 *
 * Shared between the engines for `buildWhere`'s reason, and quoting is its one
 * callback rather than two because there is no value here to bind: a sort is a
 * column and a direction, and both reach the SQL as text. So both are guarded
 * rather than parameterised -- the column through the driver's own `quoteIdent`
 * (which escapes the quote character, so a name carrying one cannot end the
 * identifier), the direction against the closed set above, checked at runtime
 * because it arrives as user JSON and the type is not the guard.
 *
 * The column is a name the *result* answered under, not one read off a catalog:
 * a browsed page and a wrapped query both order by the header the user clicked,
 * which is the only name that is true of both.
 */
export function orderByClause(
  sort: SortOrder | undefined,
  quoteIdent: (name: string) => string
): string {
  if (!sort || !sort.column) return '';
  if (!SORT_DIRECTIONS.has(sort.direction)) {
    throw new Error(`Unsupported sort direction: ${String(sort.direction)}`);
  }
  return ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`;
}

/**
 * Extract the Nth expression from the SELECT clause of `sql`.
 *
 * When Postgres returns `?column?` for an un-aliased expression like `SELECT 1`,
 * this gives us the expression text to show in the result header instead. It is a
 * positional scan, not a parser -- the text is a query that already ran, so a
 * parse error here just means we keep the `?column?` the server gave us. SQLite
 * leans on the same scan to rebuild a header its own `columnNames` deduplicated.
 *
 * Handles nested parentheses (CASE, function calls, subqueries) and stops at the
 * top-level FROM. Returns `null` when the SELECT clause cannot be located.
 */
export function selectExpressionAt(sql: string, index: number): string | null {
  // Find the outermost SELECT keyword. Step past CTEs (`WITH … AS (…) SELECT`).
  const selectMatch = /\bSELECT\b/i.exec(sql);
  if (!selectMatch) return null;

  const selStart = selectMatch.index + selectMatch[0].length;

  // Walk from after SELECT until the top-level FROM, tracking paren depth.
  // Collect the range of each top-level expression.
  const exprs: { start: number; end: number }[] = [];
  let depth = 0;
  let exprStart = selStart;

  // We need a rough end: find FROM/WHERE/GROUP/HAVING/ORDER/LIMIT/OFFSET/UNION/;
  // at the top level of the SELECT clause.
  const clauseRe = /\b(FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|;)\b/gi;
  const clauseEnd = (() => {
    clauseRe.lastIndex = selStart;
    let pos = selStart;
    let d = 0;
    let m: RegExpExecArray | null;
    while ((m = clauseRe.exec(sql)) !== null) {
      // Count parens between last position and this match
      for (let i = pos; i < m.index; i++) {
        if (sql[i] === '(') d++;
        else if (sql[i] === ')') d--;
      }
      pos = m.index;
      if (d === 0) return m.index;
    }
    return sql.length;
  })();

  for (let i = selStart; i < clauseEnd; i++) {
    const ch = sql[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      exprs.push({ start: exprStart, end: i });
      exprStart = i + 1;
    }
  }
  // The last (or only) expression: after the last comma to the clause end.
  if (exprStart < clauseEnd) {
    exprs.push({ start: exprStart, end: clauseEnd });
  }

  if (index < 0 || index >= exprs.length) return null;
  const expr = exprs[index]!;
  return sql.slice(expr.start, expr.end).trim().replace(/\s+/g, ' ');
}
