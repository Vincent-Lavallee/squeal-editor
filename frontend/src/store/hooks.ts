import { useDispatch, useSelector } from 'react-redux';

import type { AppDispatch, RootState } from './index.ts';

/**
 * The typed pair every feature hook is built from. Components do not use these
 * directly -- they use their feature's hook, which is the feature's whole
 * public surface.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
