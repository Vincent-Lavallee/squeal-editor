import { Label } from '../../common/components/Field.tsx';
import * as t from '../../common/tokens';

/**
 * A heading and the rule that runs out from it. Structure comes from 1px
 * borders, so a group of fields is named and ruled off rather than boxed into a
 * surface of its own.
 */
export default function ConnectionFormSection({ label }: { label: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
            <Label>{label}</Label>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: t.BORDER }} />
        </div>
    );
}
