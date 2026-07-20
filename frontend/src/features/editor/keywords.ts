/**
 * The dialect's own words, read out of the grammar that highlights them.
 *
 * Monaco ships a grammar per SQL dialect, not a completion provider: it knows
 * that SELECT is a keyword well enough to paint it and will never offer it to
 * you. These are the very lists it tokenizes with, so a word the editor paints
 * as a keyword is a word it suggests -- there is no second list here to drift
 * from the first, which is the whole reason to reach for them rather than to
 * type out a good-enough set of SQL words.
 *
 * Nothing here crosses the bridge, and nothing should: these are the grammar's
 * words, the engine's spelling of SQL. What the *server* has -- tables, columns
 * -- is `completion.ts`'s business and arrives over the bridge like everything
 * else that came from a database.
 *
 * The import reaches past the package's entry point at a file with no types of
 * its own; `src/monaco-languages.d.ts` is where that is declared, and why.
 */

import { language as mysql } from 'monaco-editor/esm/vs/basic-languages/mysql/mysql.js';
import { language as pgsql } from 'monaco-editor/esm/vs/basic-languages/pgsql/pgsql.js';
import { language as sql } from 'monaco-editor/esm/vs/basic-languages/sql/sql.js';

import type { SqlDialect } from '../../../../shared/protocol/index.ts';

/** What a word is, which is only ever used to pick its mark in the list. */
export type WordKind = 'keyword' | 'function';

export interface Word {
  label: string;
  kind: WordKind;
}

type Grammar = typeof mysql;

/*
 * Keyed by `SqlDialect`, so the day a driver reports a dialect this app has not
 * got a grammar for, it is a compile error here rather than an editor that
 * silently suggests nothing. `sql` is the fallback a driver names deliberately.
 */
const GRAMMARS: Record<SqlDialect, Grammar> = { mysql, pgsql, sql };

/**
 * Both lists are offered flat, and only the mark tells them apart.
 *
 * `operators` is the surprise worth knowing about: AND, IN, LIKE, NOT and JOIN
 * live there rather than in `keywords`, so taking `keywords` alone -- which is
 * what the name promises -- would offer SELECT and not AND. `monaco.ts` already
 * pays for this same quirk, painting `operator` with `--syntax-keyword`.
 */
function wordsOf(grammar: Grammar): Word[] {
  const keywords = [...grammar.keywords, ...grammar.operators, ...grammar.builtinVariables];
  return [
    ...keywords.map((label): Word => ({ label, kind: 'keyword' })),
    ...grammar.builtinFunctions.map((label): Word => ({ label, kind: 'function' })),
  ];
}

/*
 * Built once per dialect on first use and kept. The lists run to hundreds of
 * words and are constants; rebuilding them per keystroke is work with no output.
 */
const cache = new Map<SqlDialect, Word[]>();

export function wordsFor(dialect: SqlDialect): Word[] {
  const built = cache.get(dialect);
  if (built) return built;

  // Deduped: the grammars repeat a word across their lists (`NULL` and `NOT`
  // are keywords *and* operators in every one of them), and a suggestion list
  // that offers NULL twice looks broken in the one way nobody can act on.
  const seen = new Map<string, Word>();
  for (const word of wordsOf(GRAMMARS[dialect])) {
    if (!seen.has(word.label)) seen.set(word.label, word);
  }

  const words = [...seen.values()];
  cache.set(dialect, words);
  return words;
}
