/**
 * The editor's document formatter: sql-formatter, taught this app's dialect.
 *
 * The one place the UI's opaque `SqlDialect` is translated. sql-formatter names
 * dialects its own way -- `postgresql` where the protocol carries `pgsql` for
 * Monaco's sake -- so the adaptation lives here and nowhere else. The extension
 * must not grow a second dialect field to feed it: it reports one dialect, and
 * this is the map that reads it, the same shape as `keywords.ts` one step over.
 *
 * This file registers with Monaco and knows no React; it is a pure transform of
 * text in the model. `useSqlFormatter` is the wiring that mounts it.
 */

import { format, type SqlLanguage } from 'sql-formatter';

import type { SqlDialect } from '../../../../shared/protocol.ts';
import { monaco } from './monaco.ts';

/**
 * The protocol's dialect as sql-formatter spells it. `sql` is the fallback the
 * protocol already uses for an engine Monaco does not know, and sql-formatter's
 * generic `sql` is the right thing to hand it -- neither side invents a dialect.
 */
const LANGUAGE: Record<SqlDialect, SqlLanguage> = {
  mysql: 'mysql',
  pgsql: 'postgresql',
  sql: 'sql',
};

/**
 * Builds a formatting provider for one dialect. Registered per language, the
 * same as completion, so the provider is only ever asked about models it has
 * the dialect for.
 */
export function sqlFormattingProvider(
  dialect: SqlDialect
): monaco.languages.DocumentFormattingEditProvider {
  return {
    provideDocumentFormattingEdits(model) {
      let formatted: string;
      try {
        // Indent to match the editor's own tabSize, so formatting does not
        // fight the setting the rest of the document is typed under.
        // `keywordCase: 'upper'` uppercases keywords only -- identifiers, string
        // literals and the data they name are left exactly as written, which is
        // the same line the value-handling rules draw: casing SQL's own words is
        // presentation, casing anything the server gave us would be a lie.
        formatted = format(model.getValue(), {
          language: LANGUAGE[dialect],
          tabWidth: 2,
          keywordCase: 'upper',
        });
      } catch {
        // sql-formatter throws on input it cannot parse -- a half-written
        // statement, a dialect quirk it does not cover. Leave the text as it is
        // rather than surfacing a parser error: a no-op is the honest answer to
        // "I could not format this", and Monaco would otherwise pop an error.
        return [];
      }
      // One full-range replace. Monaco applies it as an edit, so the change
      // flows out through `onDidChangeModelContent` like any keystroke -- this
      // never writes the value in from outside, which is the trap `setValue`
      // is. See `docs/frontend.md`.
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  };
}
