import { serverLabel, type OpenConnection } from '../../store/sessionSlice.ts';
import SrOnly from '../../common/components/SrOnly.tsx';
import * as t from '../../common/tokens';
import { blendOver } from './railColors.ts';

interface Props {
    connection: OpenConnection;
    active: boolean;
    activeFill: string;
    workspaceName: string;
}

export default function RailChipLabel({ connection: c, active, activeFill, workspaceName }: Props) {
    return (
        <>
            {/*
              A dot, because the chip already spends its colour on
              which connection this is and repainting it would say
              "different server" rather than "same server, dropped".
            */}
            {c.lostReason && (
                <span
                    data-testid="rail-lost"
                    aria-hidden="true"
                    style={{
                        flex: 'none',
                        width: 6,
                        height: 6,
                        borderRadius: t.RADIUS_PILL,
                        background: t.AMBER,
                    }}
                />
            )}
            <span
                data-testid="rail-name"
                style={{
                    fontSize: t.TEXT_LABEL,
                    fontWeight: 500,
                }}
            >
                {c.name}
            </span>
            <span
                data-testid="rail-env"
                style={{
                    fontSize: t.TEXT_MICRO,
                    color: active ? blendOver(t.BG, activeFill, 0.65) : t.TEXT_FAINT,
                }}
                aria-hidden="true"
            >
                {c.environment}
            </span>
            <SrOnly>
                {c.name}, {workspaceName}, {c.environment}, {serverLabel(c.config)}
                {c.lostReason ? ', connection dropped' : ''}
            </SrOnly>
        </>
    );
}
