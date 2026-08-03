/**
 * The editor's completion provider: the dialect's words, plus the server's.
 *
 * Two sources, and the split is the same one that runs through the app. The
 * words come from the grammar (`keywords.ts`) and never crossed the bridge; the
 * tables and columns came from the database and did, so they arrive from the
 * store. Neither is guessed at, which is what the old word-based suggestions
 * were doing -- see `docs/decisions.md`.
 *
 * This file registers with Monaco and reads a snapshot; it dispatches nothing
 * and knows no React. `useSqlCompletion` is what keeps the snapshot current.
 */

import type { ColumnInfo, SqlDialect, TableInfo } from '../../../../shared/protocol/index.ts';
import { relationName, relationOf, type Relation } from '../../common/db/relation.ts';
import { identifierQuote, quoteIdentifierIfNeeded } from '../../common/db/sql.ts';
import type { Word } from './keywords.ts';
import { monaco } from './monaco.ts';
import { qualifierAt, resolveQualifier, scanScope } from './sqlScope.ts';

/**
 * Everything the provider reads, as of the keystroke being answered.
 *
 * It is fetched through a callback rather than handed over, because the provider
 * is registered once and the catalog changes underneath it all session.
 */
export interface CompletionSnapshot {
  words: Word[];
  /**
   * Which engine is being typed at, and therefore how a name has to be spelled
   * to survive being inserted — see `quoteIdentifierIfNeeded`.
   */
  dialect: SqlDialect;
  /** The active tab's database's tables. Empty until they land. */
  tables: TableInfo[];
  /**
   * The schema this engine leaves implied. A relation in it is offered both
   * qualified and bare, since either resolves; one in any other schema only
   * qualified. Undefined means no schema goes without saying -- an engine with no
   * schema layer, or no connection yet.
   */
  defaultSchema?: string;
  /** `null` while the fetch is in flight, or if it failed. */
  columnsFor: (table: string) => ColumnInfo[] | null;
}

const { CompletionItemKind } = monaco.languages;

/*
 * Sort groups. Monaco sorts by how well the typed prefix matches first and by
 * `sortText` within that, so these only decide ties -- which is exactly the
 * decision worth making: `id` in a table in the FROM beats `id` in some other
 * table, which beats a keyword that merely contains the letters.
 */
const SORT = { column: '0', table: '1', word: '2' } as const;

/**
 * The kinds are picked for their marks, and the marks are the whole point: a
 * column, a table and a keyword are told apart by shape at a glance, which is
 * why the theme can paint every one of them the same muted gray and stay inside
 * "chrome is grayscale". They are the nearest thing Monaco's fixed vocabulary
 * has to a relational one -- it was built for a language server.
 */
const KIND = {
  column: CompletionItemKind.Field,
  table: CompletionItemKind.Struct,
  view: CompletionItemKind.Interface,
  keyword: CompletionItemKind.Keyword,
  function: CompletionItemKind.Function,
} as const;

/** Where the item being typed starts and ends, so accepting one replaces it. */
function wordRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

/** The text of the line up to the cursor: what the scans below read. */
function lineToCursor(model: monaco.editor.ITextModel, position: monaco.Position): string {
  return model.getValueInRange({
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: 1,
    endColumn: position.column,
  });
}

/**
 * How a name has to be spelled to still name itself once it is in the query.
 *
 * **A suggestion is text the server will be asked to resolve, so it carries its
 * own quoting.** Postgres folds an unquoted identifier to lowercase, so
 * accepting `createdAt` from the tree's own catalog used to write a query
 * looking for `createdat` -- a failure whose every ingredient came from the
 * database. `quoteIdentifierIfNeeded` is conditional where the filter bar's
 * `quoteIdentifier` is not: this text is read by the person who typed it.
 *
 * `quoteAlreadyOpen` is a quote character the user typed themselves, to the left
 * of the word being completed (`SELECT "crea`). The quoting is then theirs and
 * the name goes in bare -- adding ours would spell `""createdAt"`, and widening
 * the range to swallow the one they typed would delete a character they meant.
 */
const namer = (dialect: SqlDialect, quoteAlreadyOpen: boolean) => (name: string) =>
  quoteAlreadyOpen ? name : quoteIdentifierIfNeeded(name, dialect);

const columnItem = (
  column: ColumnInfo,
  range: monaco.IRange,
  detail: string,
  insertName: (name: string) => string
): monaco.languages.CompletionItem => ({
  label: column.name,
  kind: KIND.column,
  detail,
  insertText: insertName(column.name),
  sortText: SORT.column + column.name,
  range,
});

// `relation` is passed whole rather than as its printed name because each half
// quotes itself: `"reporting"."daily_stats"` is one relation, not one quoted
// name with a dot in it. What it is *labelled* still differs by caller -- the
// unqualified list writes the schema-qualified label, while `schema.` writes the
// bare name, the schema being already typed to the left of the dot.
const tableItem = (
  table: TableInfo,
  range: monaco.IRange,
  relation: Relation,
  insertName: (name: string) => string
): monaco.languages.CompletionItem => {
  const name = relationName(relation);
  return {
    label: name,
    kind: table.kind === 'view' ? KIND.view : KIND.table,
    detail: table.kind,
    insertText:
      relation.schema === undefined
        ? insertName(relation.table)
        : `${insertName(relation.schema)}.${insertName(relation.table)}`,
    sortText: SORT.table + name,
    range,
  };
};

/**
 * Builds the provider. `snapshot` is called per request, never captured.
 */
export function sqlCompletionProvider(
  snapshot: () => CompletionSnapshot
): monaco.languages.CompletionItemProvider {
  return {
    // The dot is not a word character, so nothing would re-trigger the popup
    // after one without this -- typing `u.` would leave you pressing Ctrl+Space
    // at the exact moment the editor has the most to say.
    triggerCharacters: ['.'],

    provideCompletionItems(model, position) {
      const { words, tables, defaultSchema, columnsFor, dialect } = snapshot();
      // Scanned from the model Monaco is actually asking about, not from
      // whichever pane's hook last rendered: the provider is registered once
      // per dialect and every open editor answers through it, so a snapshot
      // fact that varies *per tab* has to be read off the request itself, not
      // closed over. Split panes are exactly the case that would otherwise
      // cross-contaminate -- see `docs/decisions.md`.
      const scope = scanScope(model.getValue());
      const range = wordRange(model, position);
      const line = lineToCursor(model, position);
      const quoteAlreadyOpen = line[range.startColumn - 2] === identifierQuote(dialect);
      const insertName = namer(dialect, quoteAlreadyOpen);

      /*
       * After a dot, the qualifier is the entire question, and it is one of two:
       * a table or alias, whose columns are the answer (`u.` -> that table's
       * columns and nothing else, since keywords cannot follow a dot); or a
       * schema, whose relations are (`public.` -> the tables in `public`). Either
       * way keywords are suppressed -- they would bury the answer under words the
       * dot has already ruled out.
       */
      const qualifier = qualifierAt(line);
      if (qualifier) {
        const table = resolveQualifier(qualifier, scope);
        const columns = table ? columnsFor(table) : null;
        // A resolved table with its columns in hand: those are the answer.
        if (columns && columns.length > 0) {
          return { suggestions: columns.map((c) => columnItem(c, range, c.dataType, insertName)) };
        }
        // Otherwise the qualifier may be a schema, and `public.` is then asking
        // for the relations in it, named bare because the schema is already
        // typed. This has to come second, not first: a name ending in a dot in
        // the FROM (`FROM public.`) is scanned as a bogus table, so `resolveQualifier`
        // claims `public` as a table -- but the catalog has no columns for it, so
        // an empty column answer is the tell that the schema was meant. A real
        // table sharing a schema's name keeps its columns, since those land here
        // non-empty and never reach this branch.
        const inSchema = tables.filter((t) => t.schema !== undefined && t.schema.toLowerCase() === qualifier.toLowerCase());
        if (inSchema.length > 0) {
          return { suggestions: inSchema.map((t) => tableItem(t, range, { table: t.name }, insertName)) };
        }
        // A real table whose columns have not landed yet, or a qualifier that is
        // neither table nor schema: an empty popup that closes on the next key,
        // never the whole dialect suggested at a dot.
        return { suggestions: [] };
      }

      const suggestions: monaco.languages.CompletionItem[] = [];

      /*
       * Columns of the tables already in the FROM/JOIN, unqualified.
       *
       * This is the case the feature is really for: `SELECT ema…` after
       * `FROM users` should offer `email`, and demanding `users.email` first
       * would be asking the reader to type the thing they came here not to
       * remember. They sort above tables and words because the query has already
       * said which tables it is about -- that is a stronger signal than a name
       * merely matching.
       */
      for (const table of scope.tables) {
        const columns = columnsFor(table);
        if (!columns) continue;
        for (const column of columns) {
          // The table is named in the detail, which the qualified case leaves
          // out: two tables in a join both have an `id`, and here the label is
          // the only thing distinguishing entries that are not the same column.
          suggestions.push(columnItem(column, range, `${column.dataType} · ${table}`, insertName));
        }
      }

      for (const table of tables) {
        // Every relation is offered fully qualified -- `public.users` reads the
        // same way `reporting.daily_stats` does.
        suggestions.push(tableItem(table, range, relationOf(table), insertName));
        // A default-schema relation also resolves unqualified, so the bare name
        // is offered too: `users` and `public.users` are both valid and either
        // may be what you want. A relation in another schema gets only the
        // qualified form -- a bare name there goes through `search_path` and does
        // not resolve. (No-schema engines never enter this branch: the qualified
        // name is already bare, so a second entry would just duplicate it.)
        if (table.schema !== undefined && table.schema === defaultSchema) {
          suggestions.push(tableItem(table, range, { table: table.name }, insertName));
        }
      }

      for (const word of words) {
        suggestions.push({
          label: word.label,
          kind: word.kind === 'function' ? KIND.function : KIND.keyword,
          insertText: word.label,
          sortText: SORT.word + word.label,
          range,
        });
      }

      return { suggestions };
    },
  };
}
