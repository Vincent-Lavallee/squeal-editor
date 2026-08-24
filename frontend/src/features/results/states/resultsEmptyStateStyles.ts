import * as t from '../../../common/tokens';

export const emptyCtr: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 0,
    padding: t.GAP_XL,
    textAlign: 'center',
};

export const headingStyle = (color: string): React.CSSProperties => ({
    color,
    fontSize: t.TEXT_TITLE,
    fontWeight: 500,
    marginBottom: t.GAP_XS,
});
