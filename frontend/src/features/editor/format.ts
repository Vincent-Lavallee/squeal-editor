/**
 * The editor's document formatter: the app's SQL style, registered with Monaco.
 *
 * The style itself is `common/db/formatSql.ts`, which is where the dialect map
 * and the sql-formatter options live -- it has a second caller in another
 * feature (the assistant formats the SQL it writes into a tab) and neither
 * feature may import the other. This file is the Monaco half and nothing else:
 * it registers, it edits a model, and it knows no React.
 */

import { formatSql } from '../../common/db/formatSql.ts';
import type { SqlDialect } from '../../../../shared/protocol/index.ts';
import { monaco } from './monaco.ts';

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
      const formatted = formatSql(model.getValue(), dialect);
      // Monaco would otherwise pop a parser error at the user about text it is
      // perfectly happy to go on editing.
      if (formatted === null) return [];
      // One full-range replace. Monaco applies it as an edit, so the change
      // flows out through `onDidChangeModelContent` like any keystroke -- this
      // never writes the value in from outside, which is the trap `setValue`
      // is. See `docs/frontend.md`.
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  };
}
