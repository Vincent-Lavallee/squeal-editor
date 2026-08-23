import { useEffect, useRef, useState } from 'react';

/**
 * The rename draft, kept as component state rather than the store: `title`
 * only earns a dispatch on commit (blur/Enter), the same split the grid draws
 * between an in-progress cell edit and the value it saves.
 */
export function useTabRename(onRename: (id: string, title: string) => void) {
    const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
    const commitRename = () => {
        if (renaming) onRename(renaming.id, renaming.draft);
        setRenaming(null);
    };

    // Focused and selected once, when rename mode is *entered* -- not an inline
    // ref callback, whose identity changes every render and which React
    // therefore re-invokes after every keystroke. Re-selecting on each of those
    // is what let only one character land at a time: the next keystroke replaced
    // the selection the previous one had just created.
    const renameInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (renaming) {
            renameInputRef.current?.focus();
            renameInputRef.current?.select();
        }
    }, [renaming?.id]);

    return { renaming, setRenaming, commitRename, renameInputRef };
}
