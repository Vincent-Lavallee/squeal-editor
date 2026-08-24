import Checkbox from '../../../common/components/Checkbox.tsx';

interface Props {
    readOnly: boolean;
    fileBased: boolean;
    ssl: boolean;
    iam: boolean;
    onReadOnlyChange: (value: boolean) => void;
    onSslChange: (value: boolean) => void;
}

/**
 * Both are answers to "how should it open", which is why they share a row
 * rather than each taking a line of their own at opposite ends of the form. A
 * file engine has no SSL, so read-only stands alone there.
 */
export default function ConnectionOptionsFields({
    readOnly,
    fileBased,
    ssl,
    iam,
    onReadOnlyChange,
    onSslChange,
}: Props) {
    return (
        <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <Checkbox
                    id="readOnly"
                    label="Open read-only"
                    hint="the server refuses writes; on by default for Production"
                    checked={readOnly}
                    onChange={(e) => onReadOnlyChange(e.target.checked)}
                />
            </div>
            {!fileBased && (
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Checkbox
                        id="ssl"
                        label="Connect over SSL"
                        checked={iam ? true : ssl}
                        disabled={iam}
                        hint={
                            iam
                                ? 'required for IAM authentication'
                                : "the server's certificate must be trusted"
                        }
                        onChange={(e) => onSslChange(e.target.checked)}
                    />
                </div>
            )}
        </div>
    );
}
