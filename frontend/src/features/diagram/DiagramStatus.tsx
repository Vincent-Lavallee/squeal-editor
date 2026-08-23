import Note from '../../common/components/Note.tsx';

export default function DiagramStatus({
    firstLoad,
    error,
    empty,
    database,
}: {
    firstLoad: boolean;
    error: string | null;
    empty: boolean;
    database: string | null;
}) {
    if (firstLoad) return <Note kind="muted">Reading the schema of {database}…</Note>;
    if (error) return <Note kind="error">{error}</Note>;
    if (empty) return <Note kind="muted">{database} holds no tables.</Note>;
    return null;
}
