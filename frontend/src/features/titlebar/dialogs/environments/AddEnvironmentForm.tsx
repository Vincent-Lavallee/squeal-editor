import Button from '../../../../common/components/Button.tsx';
import Input from '../../../../common/components/Input.tsx';
import * as t from '../../../../common/tokens';

export default function AddEnvironmentForm({
    name,
    saving,
    onChange,
    onAdd,
}: {
    name: string;
    saving: boolean;
    onChange: (name: string) => void;
    onAdd: (e: React.FormEvent) => void;
}) {
    return (
        <form style={{ display: 'flex', gap: t.GAP_SM }} onSubmit={onAdd}>
            <div style={{ flex: 1 }}>
                <Input
                    value={name}
                    placeholder="Staging"
                    disabled={saving}
                    onChange={(e) => onChange(e.target.value)}
                />
            </div>
            <Button type="submit" disabled={saving || !name.trim()}>
                + Add
            </Button>
        </form>
    );
}
