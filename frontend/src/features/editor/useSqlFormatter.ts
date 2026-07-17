/**
 * Registers the document formatter, keyed on the dialect.
 *
 * Internal to `features/editor`, the same shape as `useSqlCompletion`: the
 * registration lives here so `EditorPane` stays a component that wires Monaco
 * rather than one that reaches into its language services.
 *
 * There is nothing to keep current the way completion's catalog is -- a
 * formatter reads only the model's own text -- so this is the registration and
 * nothing else. Registering the provider is what makes Format Document work at
 * all: the Shift+Alt+F binding, the context-menu entry and the toolbar button
 * all run `editor.action.formatDocument`, which does nothing until a provider
 * answers for the language.
 */

import { useEffect } from 'react';

import type { SqlDialect } from '../../../../shared/protocol.ts';
import { sqlFormattingProvider } from './format.ts';
import { monaco } from './monaco.ts';

export function useSqlFormatter(dialect: SqlDialect): void {
  useEffect(() => {
    // One provider per language, disposed on dialect change -- two on one
    // language would both answer and Monaco would run them in turn. Same rule
    // as the completion provider next door.
    const registration = monaco.languages.registerDocumentFormattingEditProvider(
      dialect,
      sqlFormattingProvider(dialect)
    );
    return () => registration.dispose();
  }, [dialect]);
}
