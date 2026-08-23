import { SaveQueryDialog } from '../features/queries/index.ts';
import { CloseTabsConfirm } from '../features/tabs/index.ts';
import type { useShell } from './hooks/useShell.ts';

export default function ShellDialogs({ s }: { s: ReturnType<typeof useShell> }) {
    return (
        <>
            {s.namingTab && (
                <SaveQueryDialog
                    initialName={s.namingTab.title}
                    sql={s.namingTab.sql}
                    onSaved={(query) => {
                        s.markTabSaved(s.namingTab!.id, query.id, query.name, query.sql);
                        s.setNamingTab(null);
                    }}
                    onClose={() => s.setNamingTab(null)}
                />
            )}

            {s.closing && (
                <CloseTabsConfirm
                    tabs={s.closing.unsaved}
                    onConfirm={() => {
                        s.closeTabs(s.closing!.ids);
                        s.setClosing(null);
                    }}
                    onCancel={() => s.setClosing(null)}
                />
            )}
        </>
    );
}
