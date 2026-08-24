import { useMemo, useState } from 'react';

export function useTitlebarDialogs() {
    const [showingAbout, setShowingAbout] = useState(false);
    const [showingEnvironments, setShowingEnvironments] = useState(false);
    const [showingExport, setShowingExport] = useState(false);
    const [showingImport, setShowingImport] = useState(false);
    const [showingShortcuts, setShowingShortcuts] = useState(false);

    // Memoized so a consumer that depends on `open`/`close` as a whole (the
    // native menu bridge's effect deps) does not see a new object -- and
    // therefore re-subscribe -- on every render.
    const open = useMemo(
        () => ({
            about: () => setShowingAbout(true),
            environments: () => setShowingEnvironments(true),
            export: () => setShowingExport(true),
            import: () => setShowingImport(true),
            shortcuts: () => setShowingShortcuts(true),
        }),
        [],
    );
    const close = useMemo(
        () => ({
            about: () => setShowingAbout(false),
            environments: () => setShowingEnvironments(false),
            export: () => setShowingExport(false),
            import: () => setShowingImport(false),
            shortcuts: () => setShowingShortcuts(false),
        }),
        [],
    );

    return {
        showing: {
            about: showingAbout,
            environments: showingEnvironments,
            export: showingExport,
            import: showingImport,
            shortcuts: showingShortcuts,
        },
        open,
        close,
    };
}
