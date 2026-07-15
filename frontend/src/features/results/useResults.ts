import { useCallback } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { runQuery } from '../../store/resultsSlice.ts';

/** The results feature's whole public surface: what came back, and how to ask. */
export function useResults() {
  const dispatch = useAppDispatch();
  const { result, error, running } = useAppSelector((s) => s.results);

  const run = useCallback((sql: string) => void dispatch(runQuery(sql)), [dispatch]);

  return { result, error, running, run };
}
