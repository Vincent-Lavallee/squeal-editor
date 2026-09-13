import type { CellValue } from '../../../shared/protocol/index.ts';

/**
 * `rowsWritten` as a percentage of `total`, for the progress bar's width --
 * the one place a `db.count` value is read through a JS `Number`, and only
 * for this: a cosmetic ratio for a progress bar, never the number shown as a
 * fact. `total` itself is always displayed as the server's own string,
 * untouched, wherever it is shown alongside this.
 *
 * `null` when there is nothing to divide by yet, or the total is not a plain
 * positive number (defensive; `COUNT(*)` always answers one, but a `0` table
 * has no ratio to show either).
 */
export function exportPercent(rowsWritten: number, total: CellValue | null): number | null {
    if (total === null) return null;
    const denominator = Number(total);
    if (!Number.isFinite(denominator) || denominator <= 0) return null;
    return Math.min(100, Math.round((rowsWritten / denominator) * 100));
}
