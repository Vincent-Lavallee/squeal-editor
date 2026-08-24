import Callout from '../../../../common/components/Callout.tsx';

export default function ExportedSummary({
    exported,
}: {
    exported: { connections: number; workspaces: number; passwords: number };
}) {
    return (
        <Callout tone="success">
            Exported {exported.connections}{' '}
            {exported.connections === 1 ? 'connection' : 'connections'} in {exported.workspaces}{' '}
            {exported.workspaces === 1 ? 'workspace' : 'workspaces'}
            {exported.passwords > 0 ? `, ${exported.passwords} carrying a password` : ''}.
        </Callout>
    );
}
