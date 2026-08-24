import * as t from '../../../common/tokens';

export const codeBlock: React.CSSProperties = {
    margin: 0,
    padding: t.GAP,
    overflowX: 'auto',
    border: `1px solid ${t.BORDER}`,
    borderRadius: t.RADIUS,
    color: t.TEXT,
    fontFamily: t.MONO,
    fontSize: t.TEXT_BADGE,
};

export const cellStyle: React.CSSProperties = {
    padding: `4px ${t.GAP_SM}px`,
    border: `1px solid ${t.BORDER}`,
    textAlign: 'left',
    verticalAlign: 'top',
};
