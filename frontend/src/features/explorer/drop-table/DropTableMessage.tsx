import Mono from '../../../common/components/Mono.tsx';
import * as t from '../../../common/tokens';

export default function DropTableMessage({ noun, tableName }: { noun: string; tableName: string }) {
    return (
        <>
            <h2 style={{ margin: `0 0 ${t.GAP}px`, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                Drop {noun} {tableName}?
            </h2>
            <p
                style={{
                    margin: `0 0 ${t.GAP_LG}px`,
                    color: t.TEXT_MUTED,
                    fontSize: t.TEXT_BODY,
                    lineHeight: 1.5,
                }}
            >
                This runs <Mono>DROP {noun.toUpperCase()}</Mono> and cannot be undone. Type{' '}
                <Mono>{tableName}</Mono> to confirm.
            </p>
        </>
    );
}
