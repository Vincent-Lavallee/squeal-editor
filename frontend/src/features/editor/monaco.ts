/**
 * Monaco, wired for this app: its worker, and a theme built from the design
 * tokens rather than from a second set of colours written down here.
 *
 * Importing `monaco-editor` pulls the whole editor, every basic language and
 * every contributed feature. That is deliberate: find/replace, the context menu
 * and the keybindings are all contributions, and assembling them by hand means
 * a list that is silently one entry short the day someone reaches for Ctrl+/.
 * This is a local app with no network in the loop, so the cost is parse time
 * once, and nothing is being downloaded.
 */

import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

/*
 * Monaco loads its worker itself, and left alone it resolves one from a CDN.
 * A desktop app that blocks on a CDN is a bug -- the same reason the font is
 * not fetched -- so Vite bundles the worker and Monaco is handed the local one.
 *
 * The base worker is the only one needed. It ships JSON/CSS/HTML/TS workers
 * too, but those are spawned per *model language*, and every model here is SQL,
 * highlighted by a Monarch grammar that runs on the main thread.
 */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export const THEME = 'squeal';

export const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Monaco wants bare hex in token rules and #-prefixed hex in colours. */
const bare = (name: string): string => token(name).replace(/^#/, '');

/**
 * A size token as the number Monaco's options want. Sizes are written once, in
 * tokens.css, and this is how they reach an editor that takes no CSS -- the
 * same trip the colours make.
 */
export const px = (name: string): number => parseFloat(token(name));

/**
 * Reads the tokens and defines the theme. Called once, before the first editor
 * is created -- the values come from `tokens.css`, which stays the one place any
 * colour in this app is written, exactly as the window frame's paint does.
 */
export function defineTheme(): void {
  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    /*
     * `inherit: false` is load-bearing, and this is the whole reason:
     *
     * vs-dark does not only define `string` and `predefined`, it defines
     * `string.sql` (bright red) and `predefined.sql` (magenta). The SQL grammars
     * postfix every token with `.sql`, and Monaco resolves a token to the
     * *longest* matching rule -- so inheriting means vs-dark's `string.sql`
     * outranks anything spelled `string` here, and the editor comes up wearing
     * red strings and magenta functions no matter what these rules say.
     *
     * Off, these rules are the entire token palette. The widget colours below
     * are unaffected: `base` still resolves anything they leave unset to the
     * dark defaults.
     */
    inherit: false,
    rules: [
      { token: '', foreground: bare('--text') },
      { token: 'keyword', foreground: bare('--syntax-keyword') },
      // AND, OR, IN, LIKE, NOT are `operator` to these grammars, not `keyword`,
      // and they read as keywords to everyone else. `=` and `>` come along.
      { token: 'operator', foreground: bare('--syntax-keyword') },
      // Built-in functions (COUNT, NOW): keywords in every way that matters here.
      { token: 'predefined', foreground: bare('--syntax-keyword') },
      { token: 'string', foreground: bare('--syntax-string') },
      { token: 'number', foreground: bare('--syntax-number') },
      { token: 'comment', foreground: bare('--syntax-comment'), fontStyle: 'italic' },
      { token: 'delimiter', foreground: bare('--syntax-punctuation') },
      { token: 'identifier', foreground: bare('--text') },
    ],
    colors: {
      /*
       * There is one background, so every surface Monaco would otherwise shade
       * -- gutter, find widget, scrollbar -- is pinned to --bg and separated by
       * a border instead. The find widget is the menu's situation exactly: the
       * one thing that floats, so the one thing that gets an outline.
       */
      'editor.background': token('--bg'),
      'editor.foreground': token('--text'),
      'editorGutter.background': token('--bg'),
      'editorWidget.background': token('--bg'),
      'editorWidget.border': token('--border-strong'),
      'editorLineNumber.foreground': token('--text-faint'),
      // The cursor's line is marked by a brighter number, not by a lit surface
      // (see renderLineHighlight in EditorPane) -- one background, still.
      'editorLineNumber.activeForeground': token('--text'),
      'editorCursor.foreground': token('--blue'),
      'editor.selectionBackground': token('--selected'),
      /*
       * Every match wears the same tint; the one you are on is told apart by a
       * 1px outline rather than by a brighter surface. Shading it would have
       * needed a colour this system does not have -- structure comes from
       * borders here too.
       */
      'editor.findMatchBackground': token('--selected'),
      'editor.findMatchBorder': token('--blue'),
      'editor.findMatchHighlightBackground': token('--selected'),
      'editor.selectionHighlightBackground': token('--selected'),
      /*
       * The ruler down the right edge marks matches too, and its defaults are
       * amber on a gray rule -- amber means warning here, and it would be the
       * one thing on screen wearing a colour this palette never issued.
       */
      'editorOverviewRuler.findMatchForeground': token('--blue'),
      'editorOverviewRuler.selectionHighlightForeground': token('--blue'),
      'editorOverviewRuler.border': token('--border'),
      'editorIndentGuide.background1': token('--border'),
      'input.background': token('--bg'),
      'input.foreground': token('--text'),
      'input.border': token('--border-strong'),
      'focusBorder': token('--blue'),
      'scrollbarSlider.background': token('--border'),
      'scrollbarSlider.hoverBackground': token('--border-strong'),
      'scrollbarSlider.activeBackground': token('--border-strong'),
    },
  });
}

export { monaco };
