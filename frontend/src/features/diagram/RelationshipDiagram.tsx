import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import Button from '../../common/components/Button.tsx';
import Note from '../../common/components/Note.tsx';
import { DiagramIcon, ForeignKeyIcon, KeyIcon, TableIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import { edgePath, extentOf, layoutDiagram, type DiagramEdge, type DiagramNode } from './layout.ts';
import { useDiagram } from './useDiagram.ts';

/** Zoom bounds, and the step each press of the two controls takes. */
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;
/**
 * How far a pointer may travel on a node and still count as a click rather than
 * a drag. A node is both the thing you move and the thing you open, so the two
 * gestures start identically and only the distance tells them apart. Generous on
 * purpose: a press that shifts by a pixel is a click every user meant as one,
 * and the cost of guessing wrong here is opening a tab nobody asked for.
 */
const CLICK_SLOP = 5;
/** How far apart the canvas' dots sit, before zoom. */
const GRID_SPACING = 24;

interface Props {
  /** The tab this diagram is, so it draws the database that tab is pointed at. */
  tab: Tab;
  onOpenTable: (table: TableInfo) => void;
}

/** Where the user has dragged a node to, relative to where the layout put it. */
type Offsets = Record<string, { dx: number; dy: number }>;

const iconStyle = { flex: 'none', width: t.ICON, height: t.ICON } as const;

/**
 * Every table of a database, laid out with its columns and its keys, joined by
 * a line per foreign key.
 *
 * **It is a tab, and the tab is what says which database.** `Tab.database` is
 * the only thing that decides what is drawn — the same field `runQuery` and
 * `browseTable` read, one level up from a table. That is what makes two
 * diagrams on two databases two ordinary tabs rather than a view with a mode.
 *
 * **The arrangement is deliberately not remembered.** `layoutDiagram` runs from
 * the catalog every time this mounts, and dragging a node is an offset held
 * here that goes with it. A remembered arrangement would have to survive a
 * table being added, renamed or dropped, and a diagram that reopens with a node
 * pinned where a table no longer is is worse than one that arranges itself.
 */
export default function RelationshipDiagram({ tab, onOpenTable }: Props) {
  const database = tab.database;
  const { tables, defaultSchema, loading, error } = useDiagram(database);
  const [offsets, setOffsets] = useState<Offsets>({});
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);
  /**
   * Which node is being dragged, so it can be lifted above its neighbours.
   * Without it a node dragged over a taller one slides *behind* it and the
   * gesture reads as the node having been dropped somewhere it cannot be seen.
   */
  const [dragging, setDragging] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutDiagram(tables ?? [], defaultSchema), [tables, defaultSchema]);

  // A fresh arrangement means the offsets are about nodes that may no longer be
  // where they were measured against -- so they go with the layout that made
  // them meaningful, rather than being carried onto a different drawing.
  useEffect(() => { setOffsets({}); }, [layout]);

  /** Every node at where it actually sits, which is the only thing anything draws from. */
  const placed = useMemo(
    () =>
      layout.nodes.map((node) => {
        const offset = offsets[node.key];
        return offset ? { ...node, x: node.x + offset.dx, y: node.y + offset.dy } : node;
      }),
    [layout.nodes, offsets]
  );
  const byKey = useMemo(() => new Map(placed.map((node) => [node.key, node])), [placed]);
  /**
   * How much room the drawing needs *right now* — read off the placed nodes, so
   * dragging one past the edge grows the canvas to include it rather than
   * putting it somewhere the scrollbars cannot reach.
   */
  const extent = useMemo(() => extentOf(placed), [placed]);

  /*
   * Dragging a node.
   *
   * **`stopPropagation` is the first line and the whole reason this works.**
   * The canvas below pans on its own pointerdown, and a press on a node bubbles
   * to it — so both gestures ran at once and the node chased the pointer while
   * the canvas scrolled out from under it. That is what "hard to pick up" was.
   *
   * The move and up listeners go on `window`, not on the node: pointer capture
   * is requested but a captured element that re-renders — which this one does,
   * on every frame of the drag — can lose the capture, and then the pointer is
   * over a *sibling* node and the drag stops dead halfway. The window hears the
   * whole gesture regardless of what is under the cursor.
   */
  const dragNode = useCallback((key: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const base = layout.nodes.find((candidate) => candidate.key === key);
    if (!base) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = offsets[key] ?? { dx: 0, dy: 0 };
    const node = e.currentTarget as HTMLElement;
    // Best-effort: it keeps the cursor right over the whole window during a
    // drag. The listeners below are what make the drag correct without it.
    node.setPointerCapture?.(e.pointerId);
    let moved = false;

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - startX;
      const dy = move.clientY - startY;
      if (!moved) {
        if (Math.hypot(dx, dy) <= CLICK_SLOP) return;
        moved = true;
        setDragging(key);
      }
      // Divided by the zoom, or a node under a scaled canvas runs away from the
      // pointer as soon as the view is not at 100%.
      //
      // Floored so the node's drawn position never goes negative: a scroll
      // container has no negative region, so a node dragged off the top or left
      // edge would be somewhere nothing could scroll back to. Dragging the
      // other way needs no limit -- `extentOf` grows the canvas to follow.
      setOffsets((prev) => ({
        ...prev,
        [key]: {
          dx: Math.max(origin.dx + dx / zoom, -base.x),
          dy: Math.max(origin.dy + dy / zoom, -base.y),
        },
      }));
    };

    const finish = (opened: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setDragging(null);
      // The same gesture clicking the table in the tree is. A view is never a
      // node here, so the kind is not a question.
      if (opened && !moved) onOpenTable({ name: base.relation.table, schema: base.relation.schema, kind: 'table' });
    };
    const onUp = () => finish(true);
    // A cancelled pointer is the OS taking the gesture away — it is not a
    // click, and leaving the listeners on would make the *next* press continue
    // this drag.
    const onCancel = () => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [offsets, zoom, layout.nodes, onOpenTable]);

  /**
   * Dragging the canvas scrolls it. The alternative is a second offset for the
   * whole drawing, which would then have to be kept in step with the scrollbars
   * the container already has — two sources for one position.
   *
   * On `window` for `dragNode`'s reason: a pan that stops the moment the
   * pointer crosses a node is a pan that stops almost immediately.
   */
  const panCanvas = useCallback((e: React.PointerEvent) => {
    const container = scroll.current;
    if (!container || e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = container.scrollLeft;
    const startTop = container.scrollTop;
    container.style.cursor = 'grabbing';

    const onMove = (move: PointerEvent) => {
      container.scrollLeft = startLeft - (move.clientX - startX);
      container.scrollTop = startTop - (move.clientY - startY);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      container.style.cursor = 'grab';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const stepZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.min(Math.max(prev + delta, ZOOM_MIN), ZOOM_MAX));
  }, []);

  /*
   * Ctrl+wheel zooms; a bare wheel scrolls, because taking that away is the one
   * thing every canvas that does it is complained about for.
   *
   * A native listener with `passive: false` rather than an `onWheel` prop, and
   * the `preventDefault` is why: React registers its root wheel listener as
   * passive, where `preventDefault` does nothing at all — so the webview would
   * zoom *itself* on top of this, leaving the whole app scaled and no obvious
   * way back. The ref is set only while the canvas is on screen, which is also
   * when this effect has something to attach to.
   */
  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    function onWheel(e: WheelEvent): void {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    }
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [stepZoom, loading, error]);

  const referenceCount = layout.edges.length;

  return (
    <div data-testid="diagram" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* The editor's toolbar shape at the same height: the tab's database
          named at the far left as a plain label, actions at the right. A
          diagram tab has no picker, the answer a grid tab already gives —
          it is about the database it was opened on, for as long as it is open. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, flex: 'none', height: t.TAB_H, padding: `0 ${t.GAP_SM}px`, borderBottom: `1px solid ${t.BORDER}` }}>
        <DiagramIcon style={{ ...iconStyle, color: t.TEXT_MUTED }} aria-hidden="true" />
        <span data-testid="diagram-db" style={{ overflow: 'hidden', fontSize: t.TEXT_LABEL, color: t.TEXT_MUTED, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{database}</span>
        {!loading && !error && (
          <span data-testid="diagram-counts" style={{ flex: 'none', fontSize: t.TEXT_LABEL, color: t.TEXT_FAINT }}>
            {layout.nodes.length} {layout.nodes.length === 1 ? 'table' : 'tables'} · {referenceCount} {referenceCount === 1 ? 'reference' : 'references'}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" style={{ height: t.BUTTON_H_BAR, padding: `0 ${t.GAP_SM}px` }} onClick={() => stepZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out">−</Button>
        <Button variant="ghost" style={{ height: t.BUTTON_H_BAR, padding: `0 ${t.GAP_SM}px`, fontFamily: t.MONO }} onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</Button>
        <Button variant="ghost" style={{ height: t.BUTTON_H_BAR, padding: `0 ${t.GAP_SM}px` }} onClick={() => stepZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in">+</Button>
      </div>

      {loading && <Note kind="muted">Reading the schema of {database}…</Note>}
      {!loading && error && <Note kind="error">{error}</Note>}
      {!loading && !error && layout.nodes.length === 0 && <Note kind="muted">{database} holds no tables.</Note>}

      {!loading && !error && layout.nodes.length > 0 && (
        <div
          ref={scroll}
          data-testid="diagram-canvas"
          onPointerDown={panCanvas}
          style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto', cursor: 'grab' }}
        >
          {/*
            * The scroll extent is the scaled size; the drawing inside keeps its
            * own coordinates and is scaled by a transform, which sizes nothing.
            * Two elements, because one cannot be both.
            *
            * The dot grid rides on the sized one, so it scrolls with the content
            * and its *spacing* scales with the zoom while each dot stays 1px —
            * which is what makes zooming read as moving a camera over a canvas
            * rather than as the picture being redrawn at another size.
            */}
          <div
            style={{
              position: 'relative',
              // At least the pane, so the dots reach every edge: sized to the
              // drawing alone, a diagram narrower than the window leaves bare
              // background beside it and the canvas stops looking like one.
              width: `max(${extent.width * zoom}px, 100%)`,
              height: `max(${extent.height * zoom}px, 100%)`,
              backgroundImage: `radial-gradient(circle, ${t.CANVAS_DOT} 1px, transparent 1px)`,
              backgroundSize: `${GRID_SPACING * zoom}px ${GRID_SPACING * zoom}px`,
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, width: extent.width, height: extent.height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
              <Edges edges={layout.edges} extent={extent} nodes={byKey} hovered={hovered} />
              {placed.map((node) => (
                <TableNode
                  key={node.key}
                  node={node}
                  hovered={hovered === node.key}
                  dragging={dragging === node.key}
                  onHoverChange={(on) => setHovered(on ? node.key : null)}
                  onPointerDown={(e) => dragNode(node.key, e)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Every foreign key, as one path each, under the nodes.
 *
 * One `<svg>` over the whole canvas rather than one per line: a path needs both
 * ends' coordinates and those belong to two different nodes, so the only element
 * that can hold it is one that spans them both. It takes no pointer events, so
 * the nodes above it stay draggable through it.
 *
 * **Hovering a table lights its own lines and quiets the rest.** With more than
 * a handful of tables the question a diagram is opened to answer is *what does
 * this one touch*, and the lines are already drawn — so the answer costs a
 * colour rather than a control.
 */
function Edges({ edges, extent, nodes, hovered }: {
  edges: DiagramEdge[];
  extent: { width: number; height: number };
  nodes: Map<string, DiagramNode>;
  hovered: string | null;
}) {
  return (
    <svg
      width={extent.width}
      height={extent.height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        {/* One marker per colour: a marker cannot inherit the stroke of the path
            that references it, so the lit state needs its own. */}
        <marker id="diagram-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0 0 L7 3.5 L0 7 z" fill={t.BORDER_STRONG} />
        </marker>
        <marker id="diagram-arrow-lit" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0 0 L7 3.5 L0 7 z" fill={t.ACCENT} />
        </marker>
      </defs>
      {edges.map((edge) => {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (!from || !to) return null;
        const lit = hovered === edge.from || hovered === edge.to;
        // Every column of a composite key gets its own line, so a two-column
        // constraint reads as two columns rather than as one arbitrary of them.
        return edge.fromColumns.map((column, at) => (
          <path
            key={`${edge.id} ${column}`}
            d={edgePath(from, to, column, edge.toColumns[at] ?? column)}
            fill="none"
            stroke={lit ? t.ACCENT : t.BORDER_STRONG}
            strokeWidth={lit ? 1.5 : 1}
            markerEnd={`url(#${lit ? 'diagram-arrow-lit' : 'diagram-arrow'})`}
            opacity={hovered !== null && !lit ? 0.35 : 1}
          />
        ));
      })}
    </svg>
  );
}

/**
 * One table: its name, then a row per column with its key marks and its type.
 *
 * A `<button>` and not a `<div>`, because the whole box is the way into that
 * table — the same gesture as clicking it in the tree. Which means it is also
 * the drag handle, which is why the click is decided on release rather than on
 * press; see `CLICK_SLOP`.
 *
 * **`touchAction: none` is load-bearing on a touchscreen or a precision
 * trackpad.** Without it the browser claims the gesture as a pan a few pixels
 * in, fires `pointercancel`, and the node stops following the cursor mid-drag —
 * which reads as the drag being flaky rather than as the browser having taken
 * it. `userSelect: none` is the same defence against the text-selection drag.
 */
function TableNode({ node, hovered, dragging, onHoverChange, onPointerDown }: {
  node: DiagramNode;
  hovered: boolean;
  dragging: boolean;
  onHoverChange: (hovered: boolean) => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      data-testid="diagram-node"
      data-table={node.key}
      title={`${node.label} — click to open, drag to move`}
      onPointerDown={onPointerDown}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      style={{
        position: 'absolute',
        // Lifted while it is the one being moved, so it never slides behind a
        // neighbour it is being dragged across.
        zIndex: dragging ? 2 : 1,
        top: node.y,
        left: node.x,
        display: 'flex',
        flexDirection: 'column',
        width: node.width,
        padding: 0,
        overflow: 'hidden',
        border: `1px solid ${hovered || dragging ? t.ACCENT : t.BORDER_STRONG}`,
        borderRadius: t.RADIUS_LG,
        // Opaque, so the dotted canvas behind does not read through the rows.
        background: t.BG,
        color: t.TEXT,
        font: 'inherit',
        textAlign: 'left',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_DENSE, padding: `0 ${t.GAP_SM}px`, borderBottom: `1px solid ${t.BORDER}`, background: hovered || dragging ? t.SELECTED : 'transparent' }}>
        <TableIcon style={{ ...iconStyle, color: t.TEXT_MUTED }} aria-hidden="true" />
        <span data-testid="diagram-node-name" style={{ overflow: 'hidden', fontFamily: t.MONO, fontSize: t.TEXT_BADGE, fontWeight: 500, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
      </span>
      {node.table.columns.map((column) => (
        <span key={column.name} style={{ display: 'flex', alignItems: 'center', gap: 6, height: t.ROW_H_TIGHT, padding: `0 ${t.GAP_SM}px` }}>
          {/* The tree's two-stage shrink: the name keeps the default flex weight
              and the type a far higher one, so a long type gives up its width
              first and the name is the last thing to truncate. */}
          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', fontFamily: t.MONO, fontSize: t.TEXT_BADGE, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{column.name}</span>
          {column.primaryKey && <KeyIcon style={{ ...iconStyle, color: t.TEXT_MUTED }} aria-label="primary key" />}
          {node.foreignKeyColumns.has(column.name) && <ForeignKeyIcon style={{ ...iconStyle, color: t.TEXT_MUTED }} aria-label="foreign key" />}
          <span style={{ flex: '0 999 auto', minWidth: 0, marginLeft: 'auto', overflow: 'hidden', fontSize: t.TEXT_LABEL, color: t.TEXT_FAINT, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{column.dataType}</span>
        </span>
      ))}
    </button>
  );
}
