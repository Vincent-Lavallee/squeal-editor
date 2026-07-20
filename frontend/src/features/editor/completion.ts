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
      const { words, tables, scope, columnsFor } = snapshot();
      const range = wordRange(model, position);

      /*
       * After a dot, the qualifier is the entire question: `u.` asks for that
       * table's columns and nothing else. Offering keywords here too would bury
       * the answer under three hundred words that cannot follow a dot anyway.
       */
      const qualifier = qualifierAt(model, position);
      if (qualifier) {
        const table = resolveQualifier(qualifier, scope);
        const columns = table ? columnsFor(table) : null;
        // An unresolved qualifier and one whose columns have not landed are the
        // same to the reader: nothing yet. Suggesting the whole dialect at them
        // is worse than an empty popup, which at least closes on the next key.
        return { suggestions: (columns ?? []).map((c) => columnItem(c, range, c.dataType)) };
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
        suggestions.push({
          label: table.name,
          kind: table.kind === 'view' ? KIND.view : KIND.table,
          detail: table.kind,
          insertText: table.name,
          sortText: SORT.table + table.name,
          range,
        });
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
