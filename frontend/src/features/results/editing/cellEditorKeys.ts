interface Handlers {
    draft: string;
    canNull: boolean;
    onCommit: (draft: string) => void;
    onNull: () => void;
    onCancel: () => void;
}

export function handleCellEditorKey(e: React.KeyboardEvent, handlers: Handlers): void {
    const { draft, canNull, onCommit, onNull, onCancel } = handlers;
    const withModifier = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter') {
        e.preventDefault();
        onCommit(draft);
    } else if (withModifier && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        onCommit(draft);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
    } else if (canNull && withModifier && e.key === 'Delete') {
        e.preventDefault();
        onNull();
    }
}
