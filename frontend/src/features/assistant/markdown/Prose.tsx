import Markdown from './Markdown.tsx';

/**
 * The answer's text.
 *
 * It handled fenced code and nothing else for a while, on the reading that the
 * fence is the only markup that matters in an answer about SQL. Models format
 * their answers regardless, so what that shipped was tables as raw pipes and
 * `**` around words meant to be bold. `Markdown.tsx` is the hand-rolled subset
 * that replaced it — still no dependency, still no raw HTML, still nothing
 * clickable. See `docs/decisions.md`.
 */
export default function Prose({ text }: { text: string }) {
    return <Markdown text={text} />;
}
