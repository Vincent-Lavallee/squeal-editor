/**
 * The questions the rest of the app asks on the user's behalf.
 *
 * Both of these are opened *from somewhere else* — an error under a result grid,
 * a selection in the editor — and they land in a **new** assistant tab, which is
 * the whole reason they carry their subject inside them rather than leaving the
 * model to go and find it. The per-turn context describes the tab in front, and
 * by the time the first turn is sent the tab in front is the assistant tab that
 * was just opened: it holds no SQL, no result and no database. A prompt relying
 * on that context would be a prompt about nothing.
 *
 * They live here, beside `context.ts`'s system message and the tool
 * descriptions, because everything the model is told in this app's own words is
 * written in one feature. `Shell` composes them; the results grid and the editor
 * never see them, which is also what keeps either from importing a sibling.
 *
 * They read as something a person would type, because that is what the thread
 * shows: the text becomes the user's own message, sitting above the answer for
 * as long as the conversation is kept.
 */

/** Fenced, so a statement holding blank lines or a `--` comment still arrives as one block. */
const fenced = (sql: string): string => `\`\`\`sql\n${sql.trim()}\n\`\`\``;

/**
 * Diagnose a statement the server refused.
 *
 * The statement is `ResultsState.errorSql` — what was actually sent — and not
 * the tab's current text, which may be several statements or may have been
 * edited since it failed. It can still be absent (a browsed page's SQL is the
 * extension's and never crosses), and the error alone is a real question, so the
 * SQL block simply drops out rather than the button being withheld.
 *
 * The tab is named rather than identified: the model has `getAllTabs` and can
 * match on the title, which keeps a tab id out of a sentence the user has to
 * read. Saying it at all is what lets a fix be offered *into that tab*.
 */
export function diagnosePrompt({ tabTitle, database, sql, error }: {
  tabTitle: string;
  database: string | null;
  sql: string | null;
  error: string;
}): string {
  const where = database ? ` on database \`${database}\`` : '';
  return [
    `This failed in my tab "${tabTitle}"${where}. What went wrong, and how do I fix it?`,
    sql ? `\n${fenced(sql)}` : '',
    `\nThe server said:\n\n${error}`,
  ].join('');
}

/**
 * Explain the SQL the user has highlighted.
 *
 * The selected text travels in the message rather than being read back through
 * `getEditorSelection`: that tool answers for the primary pane's *active* tab,
 * which is the assistant tab by the time the turn is sent, so it would find
 * nothing. This is the same reason the diagnosis carries its statement.
 */
export function explainPrompt({ tabTitle, database, sql }: {
  tabTitle: string;
  database: string | null;
  sql: string;
}): string {
  const where = database ? ` It runs against \`${database}\`.` : '';
  return `Explain this SQL from my tab "${tabTitle}".${where} What does it do, and is there anything about it I should know?\n\n${fenced(sql)}`;
}
