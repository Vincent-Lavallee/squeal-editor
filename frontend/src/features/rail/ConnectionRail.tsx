import type { Workspace } from '../../../../shared/protocol/index.ts';
import { environmentAbbrev, environmentLabel } from '../../common/db/environments.ts';
import { useAppSelector } from '../../store/hooks.ts';
import { serverLabel, useSession, type OpenConnection } from '../../store/sessionSlice.ts';
import { selectWorkspaces } from '../../store/workspacesSlice.ts';
import { DEFAULT_WORKSPACE_COLOR, workspaceColor } from '../../common/icons/workspaceColors.ts';
import { workspaceGlyph } from '../../common/icons/workspaceIcons.ts';
import SrOnly from '../../common/components/SrOnly.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

function blendOverBg(fg: string, opacity: number): string {
  const r = parseInt(fg.slice(1, 3), 16); const g = parseInt(fg.slice(3, 5), 16); const b = parseInt(fg.slice(5, 7), 16);
  const bgR = parseInt(t.BG.slice(1, 3), 16); const bgG = parseInt(t.BG.slice(3, 5), 16); const bgB = parseInt(t.BG.slice(5, 7), 16);
  const lerp = (c: number, bgC: number) => Math.round(bgC + (c - bgC) * opacity);
  return `#${[lerp(r, bgR), lerp(g, bgG), lerp(b, bgB)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function blendOver(fg: string, bg: string, opacity: number): string {
  const fgR = parseInt(fg.slice(1, 3), 16); const fgG = parseInt(fg.slice(3, 5), 16); const fgB = parseInt(fg.slice(5, 7), 16);
  const bgR = parseInt(bg.slice(1, 3), 16); const bgG = parseInt(bg.slice(3, 5), 16); const bgB = parseInt(bg.slice(5, 7), 16);
  const lerp = (c: number, bgC: number) => Math.round(bgC + (c - bgC) * opacity);
  return `#${[lerp(fgR, bgR), lerp(fgG, bgG), lerp(fgB, bgB)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

interface Props { onAdd: () => void; }
interface Group { workspace: Workspace | undefined; connections: OpenConnection[]; }

function groupByWorkspace(connections: OpenConnection[], workspaces: Workspace[]): Group[] {
  const groups: Group[] = []; const indexOf = new Map<string, number>();
  for (const c of connections) {
    let at = indexOf.get(c.workspaceId);
    if (at === undefined) { at = groups.length; indexOf.set(c.workspaceId, at); groups.push({ workspace: workspaces.find((w) => w.id === c.workspaceId), connections: [] }); }
    groups[at]!.connections.push(c);
  }
  return groups;
}

export default function ConnectionRail({ onAdd }: Props) {
  const { connections, activeConnectionId, activate } = useSession();
  const workspaces = useAppSelector(selectWorkspaces);
  const grouped = groupByWorkspace(connections, workspaces);

  return (
    <nav data-testid="rail" style={{ display: 'flex', alignItems: 'stretch', flex: 'none', height: t.RAIL_H, padding: `0 ${t.GAP_SM}px`, borderBottom: `1px solid ${t.BORDER}`, overflowX: 'auto' }} aria-label="Open connections">
      <ul style={{ display: 'flex', alignItems: 'stretch', listStyle: 'none', margin: 0, padding: 0 }}>
        {grouped.map(({ workspace, connections: conns }, i) => {
          const Glyph = workspaceGlyph(workspace?.icon ?? 'stack');
          const tint = workspaceColor(workspace?.color ?? DEFAULT_WORKSPACE_COLOR);
          const name = workspace?.name ?? 'Workspace';
          const wash = blendOverBg(tint, 0.12);

          return (
            <li key={workspace?.id ?? `missing-${i}`}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: `0 ${t.GAP}px`, ...(i === 0 ? { paddingLeft: 0 } : {}), ...(i > 0 ? { borderLeft: `1px solid ${t.BORDER}` } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, color: tint, fontSize: t.TEXT_MICRO, fontWeight: 700, lineHeight: 1, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                <Glyph style={iconSvg} /><span>{name}</span>
              </div>
              <ul style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, listStyle: 'none', margin: 0, padding: 0 }}>
                {conns.map((c) => {
                  const active = c.connectionId === activeConnectionId;
                  return (
                    <li key={c.connectionId}>
                      <button type="button" data-testid="rail-item"
                        style={{ display: 'inline-flex', alignItems: 'baseline', gap: t.GAP_XS, padding: `1px ${t.GAP_XS}px`, borderRadius: t.RADIUS_PILL, border: `1px solid ${tint}`, background: active ? tint : wash, color: active ? t.BG : t.TEXT_MUTED, font: 'inherit', lineHeight: 1, whiteSpace: 'nowrap', cursor: 'pointer' }}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => activate(c.connectionId)}
                        title={`${c.name} — ${environmentLabel(c.environment)} — ${serverLabel(c.config)}`}>
                        <span data-testid="rail-name" style={{ fontSize: t.TEXT_LABEL, fontWeight: 500 }}>{c.name}</span>
                        <span data-testid="rail-env" style={{ fontSize: t.TEXT_MICRO, color: active ? blendOver(t.BG, tint, 0.65) : t.TEXT_FAINT }} aria-hidden="true">{environmentAbbrev(c.environment)}</span>
                        <SrOnly>{c.name}, {name}, {environmentLabel(c.environment)}, {serverLabel(c.config)}</SrOnly>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <button type="button" data-testid="rail-add" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', alignSelf: 'center', width: 28, height: 28, marginLeft: 'auto', border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
        onClick={onAdd} title="Open another connection"><span aria-hidden="true">+</span><SrOnly>Open another connection</SrOnly></button>
    </nav>
  );
}
