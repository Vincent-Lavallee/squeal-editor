import { useFeatureHooks } from './useFeatureHooks.ts';
import { useTabsAndSession } from './useTabsAndSession.ts';

/**
 * Every hook `ShellLayout` calls purely to reach into a slice or a feature's
 * own context -- no cross-feature logic of its own. Composed from
 * `useTabsAndSession` and `useFeatureHooks`, the way `useSelect` composes its
 * own pieces; nothing else in `useShell` depends on how this is split.
 */
export function useShellData() {
    const tabsAndSession = useTabsAndSession();
    const features = useFeatureHooks({
        activeTab: tabsAndSession.activeTab,
        secondaryActiveTab: tabsAndSession.secondaryActiveTab,
        dialect: tabsAndSession.dialect,
    });

    return { ...tabsAndSession, ...features };
}
