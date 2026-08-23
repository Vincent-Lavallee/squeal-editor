import { useEffect } from 'react';
import type { TriggerInfo } from '../../../../shared/protocol/index.ts';
import TriggerRow from './TriggerRow.tsx';
import type { useExplorer } from './useExplorer.ts';

export default function Triggers({
    triggers,
    table,
    indented,
    onLoadTriggers,
    onShowDefinition,
    onContextMenu,
}: {
    triggers: ReturnType<ReturnType<typeof useExplorer>['triggersFor']>;
    table: string;
    schema?: string;
    indented: boolean;
    onLoadTriggers: () => void;
    onShowDefinition: (trigger: TriggerInfo) => void;
    onContextMenu: (trigger: TriggerInfo, x: number, y: number) => void;
}) {
    const pad = indented ? 42 : 30;

    // Load triggers when first rendered if not already loaded
    useEffect(() => {
        if (triggers === undefined) {
            onLoadTriggers();
        }
    }, [table, triggers, onLoadTriggers]);

    if (triggers == null) return null;
    if (triggers.length === 0) return null;

    return (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {triggers.map((trigger) => (
                <TriggerRow
                    key={trigger.name}
                    trigger={trigger}
                    pad={pad}
                    onShowDefinition={onShowDefinition}
                    onContextMenu={onContextMenu}
                />
            ))}
        </ul>
    );
}
