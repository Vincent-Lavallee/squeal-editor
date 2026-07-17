/**
 * The shape of Monaco's basic-language grammars, which ship no types of their own.
 *
 * `monaco-editor` declares its API and its `*.contribution` modules, but the
 * grammar files those contributions lazily load are plain untyped JS. This is
 * the same situation as `neutralino.d.ts`: something real that TypeScript cannot
 * see, declared as narrowly as it is actually used.
 *
 * Only the word lists are declared. A Monarch grammar carries its tokenizer and
 * its bracket configuration too, and nothing here has any business with either --
 * the editor is what tokenizes; this app only wants the words.
 */
declare module 'monaco-editor/esm/vs/basic-languages/*' {
  export const language: {
    /** Reserved words: SELECT, FROM, CREATE. */
    keywords: string[];
    /**
     * Word-shaped operators only -- AND, IN, LIKE, NOT, JOIN. The SQL grammars
     * put no symbols in this list, which is why it can be offered as-is; they
     * are `operator` to the tokenizer and keywords to everyone else, which is
     * the same reason `monaco.ts` paints this token with `--syntax-keyword`.
     */
    operators: string[];
    /** COUNT, NOW, COALESCE. */
    builtinFunctions: string[];
    /** @@version and friends. Empty for both engines this app speaks today. */
    builtinVariables: string[];
  };
}
