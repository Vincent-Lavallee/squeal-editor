import { gutterHeadStyle } from './resultsGridStyles.ts';

interface Props {
    onSelectAll: () => void;
    onOpenMenu: (e: React.MouseEvent) => void;
}

export default function ResultsGridCornerCell({ onSelectAll, onOpenMenu }: Props) {
    return (
        <th
            className="gutter"
            style={{ ...gutterHeadStyle, cursor: 'pointer' }}
            onClick={onSelectAll}
            onContextMenu={onOpenMenu}
            title="Select everything (Ctrl+A)"
        />
    );
}
