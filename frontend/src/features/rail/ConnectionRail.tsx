import { serverLabel, useSession, type OpenConnection } from '../../store/sessionSlice.ts';
import { environmentLabel } from '../../environments.ts';

interface Props {
  /** Routes to the connect screen with everything here left open. `App` owns that. */
  onAdd: () => void;
}

/**
 * What a connection reads as. Its name if it has one -- an ad-hoc connection is
 * saved nowhere and may not -- and the server otherwise, which is the only other
 * thing that tells two of them apart.
 */
const label = (c: OpenConnection): string => c.name || serverLabel(c.config);

/**
 * The mark on the rail: at most two letters, from the label's first two words.
 *
 * A drawing would be better and there is nothing to draw -- a connection is not
 * a workspace, it has no icon anyone picked. So the mark is derived, the
 * environment's colour tells the two "Billing" connections apart, and the name
 * is a breath away in the tooltip.
 */
function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * The open connections, and the way between them.
 *
 * It names the *connection*; the titlebar names the server the active one is on.
 * Those are two different facts, so neither repeats the other -- the rail says
 * which, the titlebar says what.
 *
 * Switching is all it does. Disconnecting is the titlebar's Disconnect, which
 * has always meant "the one in front" and still does: a close button per row
 * would be a second way to do it, in 44px, for the connection you are least
 * likely to be looking at.
 */
export default function ConnectionRail({ onAdd }: Props) {
  const { connections, activeConnectionId, activate } = useSession();

  return (
    <nav className="rail" aria-label="Open connections">
      <ul className="rail__list">
        {connections.map((c) => {
          const name = label(c);
          const active = c.connectionId === activeConnectionId;
          return (
            <li key={c.connectionId}>
              <button
                type="button"
                className={`rail__item ${active ? 'rail__item--active' : ''}`}
                // The environment travels as data and CSS picks the colour off
                // it. Building `var(--env-${c.environment})` in here would be a
                // colour in a component, one `if` away from a hardcoded one.
                data-env={c.environment}
                aria-current={active ? 'true' : undefined}
                onClick={() => activate(c.connectionId)}
                title={`${name} — ${environmentLabel(c.environment)} — ${serverLabel(c.config)}`}
              >
                <span className="rail__mark" aria-hidden="true">
                  {initials(name)}
                </span>
                {/* The tooltip is not reachable without a pointer, and the mark
                    is two letters of a name. This is what a screen reader and a
                    keyboard get instead. */}
                <span className="sr-only">
                  {name}, {environmentLabel(c.environment)}, {serverLabel(c.config)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button type="button" className="rail__add" onClick={onAdd} title="Open another connection">
        <span aria-hidden="true">+</span>
        <span className="sr-only">Open another connection</span>
      </button>
    </nav>
  );
}
