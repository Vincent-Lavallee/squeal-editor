import { useEffect } from 'react';
import type { SqlDialect } from '../../../../../shared/protocol/index.ts';
import { monaco } from '../monaco.ts';

// The engine names its own dialect; the UI only passes it along. Every model,
// not just the one showing, or a background tab comes back as plain SQL.
export function useSyncModelLanguage(
    modelsRef: React.MutableRefObject<Map<string, monaco.editor.ITextModel>>,
    dialect: SqlDialect,
) {
    useEffect(() => {
        modelsRef.current.forEach((model) => monaco.editor.setModelLanguage(model, dialect));
    }, [dialect]);
}
