import { NextPageIcon, PrevPageIcon } from '../../icons.ts';
import { useResults } from './useResults.ts';

export default function ResultsTable() {
  const { result, browse, error, running, next, prev } = useResults();

  if (running) return <div className="note note--muted">Running…</div>;
  if (error) return <div className="note note--error">{error}</div>;
  if (!result) return <div className="note note--muted">Run a query to see results.</div>;

  // Statements like INSERT/UPDATE come back with no column set, just a count.
  if (result.columns.length === 0) {
    return <div className="note note--ok">{result.message}</div>;
  }

  const count = result.rows.length;
  // Rows are numbered from where the page starts, not from 1: on page 2 a gutter
  // counting 1..100 again would name two different rows the same thing.
  const firstRow = browse ? browse.offset + 1 : 1;
  // A table that fits on one page has nowhere to go, and two dead buttons say
  // "there is paging here" about the one case where there is not.
  const paged = browse !== null && (browse.hasMore || browse.offset > 0);

  return (
    <>
      <div className="results__bar">
        <span>
          {browse
            ? `${browse.table} · rows ${firstRow}–${browse.offset + count}`
            : `${count} row${count === 1 ? '' : 's'}`}{' '}
          · {result.durationMs} ms
        </span>

        {paged && browse && (
          <div className="results__pager">
            <button
              className="btn btn--ghost"
              onClick={prev}
              disabled={browse.offset === 0}
              title="Previous page"
            >
              <PrevPageIcon className="icon" aria-hidden="true" />
              Prev
            </button>
            <button className="btn btn--ghost" onClick={next} disabled={!browse.hasMore} title="Next page">
              Next
              <NextPageIcon className="icon" aria-hidden="true" />
            </button>
          </div>
        )}
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
                <td className="gutter">{firstRow + r}</td>
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
