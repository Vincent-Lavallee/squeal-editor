import Input from '../../common/components/Input.tsx';
import type { FilterDraft } from './ResultsContext.tsx';
import { barStyle, leadStyle, valueStyle } from './filterBarStyles.ts';

interface Props {
    draft: FilterDraft;
    onDraftChange: (draft: FilterDraft) => void;
    onApply: () => void;
    actions: React.ReactNode;
}

export default function FilterRawBar({ draft, onDraftChange, onApply, actions }: Props) {
    return (
        <div
            data-testid="results-filterbar"
            style={{ ...barStyle, gridTemplateColumns: '52px 1fr auto' }}
        >
            <span style={leadStyle}>WHERE</span>
            <Input
                data-testid="filter-raw"
                style={valueStyle}
                placeholder="created_at > now() - interval '7 days'"
                value={draft.where}
                onChange={(e) => onDraftChange({ ...draft, where: e.target.value })}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onApply();
                }}
            />
            {actions}
        </div>
    );
}
