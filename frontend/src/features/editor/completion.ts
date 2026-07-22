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

import type { ColumnInfo, TableInfo } from '../../../../shared/protocol/index.ts';
import { relationName, relationOf } from '../../common/db/relation.ts';
import type { Word } from './keywords.ts';
import { monaco } from './monaco.ts';
import { resolveQualifier, type SqlScope } from './sqlScope.ts';

/**
 * Everything the provider reads, as of the keystroke being answered.
 *
 * It is fetched through a callback rather than handed over, because the provider
 * is registered once and the catalog changes underneath it all session.
 */
export interface CompletionSnapshot {
  words: Word[];
  /** The active tab's database's tables. Empty until they land. */
  tables: TableInfo[];
  /**
   * The schema this engine leaves implied. A relation in it is offered both
   * qualified and bare, since either resolves; one in any other schema only
   * qualified. Undefined means no schema goes without saying -- an engine with no
   * schema layer, or no connection yet.
   */
  defaultSchema?: string;
  scope: SqlScope;
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

/**
 * The `users.` or `u.` immediately left of the cursor, if there is one.
 *
 * A qualifier may itself be schema-qualified -- `reporting.hits.` is a Postgres
 * relation and a dot, not an alias and two dots -- so the pattern takes the
 * longest name it can before the final dot.
 */
const QUALIFIER = /([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\.[\w$]*$/;

function qualifierAt(model: monaco.editor.ITextModel, position: monaco.Position): string | null {
  const line = model.getValueInRange({
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: 1,
    endColumn: position.column,
  });
  return QUALIFIER.exec(line)?.[1] ?? null;
}

const columnItem = (
  column: ColumnInfo,
  range: monaco.IRange,
  detail: string
): monaco.languages.CompletionItem => ({
  label: column.name,
  kind: KIND.column,
  detail,
  insertText: column.name,
  sortText: SORT.column + column.name,
  range,
});

// `name` is passed rather than derived because it differs by caller: the
// unqualified list writes the schema-qualified label, while `schema.` writes the
// bare name, the schema being already typed to the left of the dot.
const tableItem = (
  table: TableInfo,
  range: monaco.IRange,
  name: string
): monaco.languages.CompletionItem => ({
  label: name,
  kind: table.kind === 'view' ? KIND.view : KIND.table,
  detail: table.kind,
  insertText: name,
  sortText: SORT.table + name,
  range,
});

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
      const { words, tables, defaultSchema, scope, columnsFor } = snapshot();
      const range = wordRange(model, position);

      /*
       * After a dot, the qualifier is the entire question, and it is one of two:
       * a table or alias, whose columns are the answer (`u.` -> that table's
       * columns and nothing else, since keywords cannot follow a dot); or a
       * schema, whose relations are (`public.` -> the tables in `public`). Either
       * way keywords are suppressed -- they would bury the answer under words the
       * dot has already ruled out.
       */
      const qualifier = qualifierAt(model, position);
      if (qualifier) {
        const table = resolveQualifier(qualifier, scope);
        const columns = table ? columnsFor(table) : null;
        // A resolved table with its columns in hand: those are the answer.
        if (columns && columns.length > 0) {
          return { suggestions: columns.map((c) => columnItem(c, range, c.dataType)) };
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
          return { suggestions: inSchema.map((t) => tableItem(t, range, t.name)) };
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
          suggestions.push(columnItem(column, range, `${column.dataType} · ${table}`));
        }
      }

      for (const table of tables) {
        // Every relation is offered fully qualified -- `public.users` reads the
        // same way `reporting.daily_stats` does.
        suggestions.push(tableItem(table, range, relationName(relationOf(table))));
        // A default-schema relation also resolves unqualified, so the bare name
        // is offered too: `users` and `public.users` are both valid and either
        // may be what you want. A relation in another schema gets only the
        // qualified form -- a bare name there goes through `search_path` and does
        // not resolve. (No-schema engines never enter this branch: the qualified
        // name is already bare, so a second entry would just duplicate it.)
        if (table.schema !== undefined && table.schema === defaultSchema) {
          suggestions.push(tableItem(table, range, table.name));
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
