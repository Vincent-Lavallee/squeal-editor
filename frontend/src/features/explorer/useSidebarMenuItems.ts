import type { FunctionInfo, TriggerInfo } from '../../../../shared/protocol/index.ts';
import type { MenuItem } from '../../common/components/ContextMenu.tsx';

const copyName = (name: string) => void Neutralino.clipboard.writeText(name);

interface Options {
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    onShowTriggerDefinition: (
        database: string,
        table: string,
        trigger: TriggerInfo,
        schema?: string,
    ) => void;
}

/** What a function or trigger's right-click menu offers. Split out of
 *  `Sidebar` purely for length. */
export function useSidebarMenuItems({
    onShowFunctionDefinition,
    onShowTriggerDefinition,
}: Options) {
    const functionMenuItems = (func: FunctionInfo, db: string): MenuItem[] => [
        { label: 'Copy name', onSelect: () => copyName(func.name) },
        { label: 'Open definition', onSelect: () => onShowFunctionDefinition(db, func) },
    ];

    const triggerMenuItems = (
        trigger: TriggerInfo,
        table: string,
        schema: string | undefined,
        db: string,
    ): MenuItem[] => [
        { label: 'Copy name', onSelect: () => copyName(trigger.name) },
        {
            label: 'Open definition',
            onSelect: () => onShowTriggerDefinition(db, table, trigger, schema),
        },
    ];

    return { functionMenuItems, triggerMenuItems };
}
