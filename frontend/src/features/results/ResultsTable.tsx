import { useResults } from './useResults.ts';

/** Previews ask for 100; hitting exactly that probably means there is more. */
const PREVIEW_LIMIT = 100;

export default function ResultsTable() {
  const { result, error, running } = useResults();

  if (running) return <div className="note note--muted">Running…</div>;
  if (error) return <div className="note note--error">{error}</div>;
  if (!result) return <div className="note note--muted">Run a query to see results.</div>;

  // Statements like INSERT/UPDATE come back with no column set, just a count.
  if (result.columns.length === 0) {
    return <div className="note note--ok">{result.message}</div>;
  }

  const truncated = result.rows.length === PREVIEW_LIMIT;

  return (
    <>
      <div className="results__bar">
        <span>
          {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · {result.durationMs} ms
        </span>
        {truncated && <span className="badge badge--amber">first {PREVIEW_LIMIT}</span>}
      </div>

      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="gutter" />
              {result.columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, r) => (
              <tr key={r}>
                <td className="gutter">{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c}>{cell === null ? <span className="null">NULL</span> : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
