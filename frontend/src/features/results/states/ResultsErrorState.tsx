import { AssistantIcon, CopyIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import { errorAction, iconSvg } from '../grid/resultsGridStyles.ts';

const emptyCtr: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 0,
    padding: t.GAP_XL,
    textAlign: 'center',
};

const boxStyle: React.CSSProperties = {
    position: 'relative',
    maxWidth: 560,
    width: '100%',
    padding: t.GAP,
    border: `1px solid ${t.RED}`,
    borderRadius: t.RADIUS_LG,
    background: t.RED_BG,
    color: t.RED_TEXT,
    fontSize: t.TEXT_BODY,
    fontFamily: t.MONO,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    textAlign: 'left',
};

interface Props {
    tabBars: React.ReactNode;
    error: string;
    errorSql: string | null;
    onDiagnose?: (failure: { sql: string | null; error: string }) => void;
}

export default function ResultsErrorState({ tabBars, error, errorSql, onDiagnose }: Props) {
    return (
        <>
            {tabBars}
            <div style={emptyCtr}>
                <div data-testid="note-error" style={boxStyle}>
                    {/* Both controls sit in one row in the corner rather than each being
              positioned on its own, so a second one cannot land on top of the
              first the day a third arrives. They keep the box's own red: this
              is chrome inside a semantic surface, and an accent button here
              would be a second thing shouting in a box that is already loud. */}
                    <div
                        style={{
                            position: 'absolute',
                            top: t.GAP_SM,
                            right: t.GAP_SM,
                            display: 'flex',
                            gap: t.GAP_XS,
                        }}
                    >
                        {/* Only with a key stored: a button that opens the assistant onto
                its connect screen is an offer of help that turns into a form. */}
                        {onDiagnose && (
                            <button
                                type="button"
                                data-testid="diagnose-error"
                                style={errorAction}
                                onClick={() => onDiagnose({ sql: errorSql, error })}
                                title="Diagnose with AI"
                                aria-label="Diagnose with AI"
                            >
                                <AssistantIcon style={iconSvg} />
                            </button>
                        )}
                        <button
                            type="button"
                            style={errorAction}
                            onClick={() => void Neutralino.clipboard.writeText(error)}
                            title="Copy error"
                            aria-label="Copy error"
                        >
                            <CopyIcon style={iconSvg} />
                        </button>
                    </div>
                    {error}
                </div>
            </div>
        </>
    );
}
