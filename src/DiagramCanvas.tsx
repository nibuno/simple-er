import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode, RefObject } from "react";
import type { Column, Diagram, Endpoint, Point, Table, View } from "./types.ts";
import {
  height,
  HEADER,
  ROW,
  rounded,
  routeEdges,
  tableWidth,
} from "./geometry.ts";
import { RelationshipDecorations } from "./RelationshipDecorations.tsx";
import { relationshipLabels } from "./relationships.ts";
import { overlaps } from "./utils.ts";
import { Icon } from "./icons.tsx";

interface Props {
  logical?: boolean;
  onRename?: (
    table: string,
    columnId: string | undefined,
    value: string,
  ) => void;
  state: Diagram;
  selected: string | null;
  selectedTable?: string | null;
  onSelectTable?: (id: string) => void;
  revealRequest?: { id: string; n: number } | null;
  adjustingLine?: boolean;
  onAdjustable?: (value: boolean) => void;
  pending: Endpoint | null;
  displayTable: (t: Table) => string;
  displayColumn: (c: Column) => string;
  onEdit: (id: string) => void;
  onConnect: (table: string, row: number) => void;
  onLink?: (from: Endpoint, to: Endpoint) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
  onHint: (hint: string) => void;
  onCommit: (next: Diagram, before?: Diagram) => void;
  onPreview: (next: Diagram) => void;
  fitRequest: number;
  viewRef: RefObject<View>;
  children: ReactNode;
}
type Drag =
  | {
      kind: "table";
      id: string;
      start: Point;
      x: number;
      y: number;
      before: Diagram;
      pointer: number;
      moved?: boolean;
    }
  | {
      kind: "edge";
      id: string;
      min: number;
      max: number;
      before: Diagram;
      pointer: number;
    }
  | { kind: "pan"; start: Point; view: View; pointer: number }
  | { kind: "link"; from: Endpoint; origin: Point; pointer: number };
const steps = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400];
export function DiagramCanvas(p: Props) {
  const [renaming, setRenaming] = useState<{
    table: string;
    columnId?: string;
    value: string;
  } | null>(null);
  const [renameError, setRenameError] = useState("");
  function beginRename(t: Table, c?: Column) {
    p.onClear();
    setRenameError("");
    setRenaming({
      table: t.id,
      columnId: c?.id,
      value: c
        ? p.logical
          ? (c.logicalName ?? "")
          : c.name
        : p.logical
          ? (t.logicalName ?? "")
          : (t.name ?? t.id),
    });
  }

  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null);
  const [linking, setLinking] = useState<{
    from: Endpoint;
    origin: Point;
    to: Point;
    target: Endpoint | null;
  } | null>(null);
  /** The column row under a diagram point, if any. */
  function rowAt(pos: Point): Endpoint | null {
    for (const t of latest.current.state.tables) {
      const i = Math.floor((pos.y - t.y - HEADER) / ROW);
      if (
        pos.x >= t.x &&
        pos.x <= t.x + tableWidth(t) &&
        i >= 0 &&
        i < t.columns.length
      )
        return { table: t.id, row: i };
    }
    return null;
  }
  useEffect(() => {
    // Blank SVG areas do not consistently move focus in browsers.
    // Release the old diagram control before the clicked control takes focus.
    const releaseFocus = (event: globalThis.PointerEvent) => {
      const active = document.activeElement;
      if (
        event.button === 0 &&
        active instanceof SVGElement &&
        svg.current?.contains(active) &&
        event.target instanceof Node &&
        !active.contains(event.target)
      ) {
        active.blur();
      }
    };
    document.addEventListener("pointerdown", releaseFocus, true);
    return () =>
      document.removeEventListener("pointerdown", releaseFocus, true);
  }, []);
  const [view, setView] = useState<View>({
    x: 0,
    y: 0,
    w: 1200,
    h: 720,
    zoom: 100,
  });
  const latest = useRef(p);
  latest.current = p;
  p.viewRef.current = view;
  const routes = useMemo(
    () => routeEdges(p.state.edges, p.state.tables),
    [p.state],
  );
  const latestRoutes = useRef(routes);
  latestRoutes.current = routes;
  const labels = useMemo(
    () => relationshipLabels(p.state, routes),
    [p.state, routes],
  );
  const latestLabels = useRef(labels);
  latestLabels.current = labels;
  function viewport() {
    return {
      w: Math.max(1, svg.current?.clientWidth ?? 1200),
      h: Math.max(1, svg.current?.clientHeight ?? 720),
    };
  }
  function zoom(
    percent: number,
    cx = view.x + view.w / 2,
    cy = view.y + view.h / 2,
  ) {
    const size = viewport(),
      w = (size.w * 100) / percent,
      h = (size.h * 100) / percent;
    setView({ x: cx - w / 2, y: cy - h / 2, w, h, zoom: percent });
  }
  function fit(reset = false) {
    const tables = latest.current.state.tables;
    if (!tables.length) {
      zoom(100, 0, 0);
      return;
    }
    const points = [
      ...[...latestRoutes.current.values()].flatMap((r) => r.points),
      ...[...latestLabels.current.values()].flatMap((l) => [
        { x: l.x, y: l.y },
        { x: l.x + l.width, y: l.y + l.height },
      ]),
    ];
    const x =
        Math.min(...tables.map((t) => t.x), ...points.map((p) => p.x)) - 70,
      y = Math.min(...tables.map((t) => t.y), ...points.map((p) => p.y)) - 80;
    const right =
        Math.max(
          ...tables.map((t) => t.x + tableWidth(t)),
          ...points.map((p) => p.x),
        ) + 70,
      bottom =
        Math.max(
          ...tables.map((t) => t.y + height(t)),
          ...points.map((p) => p.y),
        ) + 100,
      size = viewport();
    zoom(
      reset ? 100 : Math.min(size.w / (right - x), size.h / (bottom - y)) * 100,
      (x + right) / 2,
      (y + bottom) / 2,
    );
  }
  useLayoutEffect(() => {
    fit(true);
    const observer = new ResizeObserver(() => {
      const size = viewport();
      setView((v) => {
        const w = (size.w * 100) / v.zoom,
          h = (size.h * 100) / v.zoom;
        // Keep the clicked title in place when the inspector changes the width,
        // so the second click of a double-click still reaches the same table.
        return { ...v, y: v.y + (v.h - h) / 2, w, h };
      });
    });
    observer.observe(svg.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (p.fitRequest) fit();
  }, [p.fitRequest]);
  useEffect(() => {
    const t = p.revealRequest
      ? latest.current.state.tables.find((t) => t.id === p.revealRequest!.id)
      : undefined;
    if (!t) return;
    setView((v) => {
      const w = tableWidth(t),
        h = Math.min(height(t), v.h - 80),
        margin = 40;
      const inside =
        t.x >= v.x + margin &&
        t.y >= v.y + margin &&
        t.x + w <= v.x + v.w - margin &&
        t.y + h <= v.y + v.h - margin;
      if (inside) return v;
      return {
        ...v,
        x: t.x + w / 2 - v.w / 2,
        y: t.y + Math.min(height(t), v.h) / 2 - v.h / 2,
      };
    });
  }, [p.revealRequest]);
  useEffect(() => {
    const canvas = svg.current!;
    let gestureScale: number | null = null;
    function zoomAt(factor: number, clientX: number, clientY: number) {
      const size = viewport();
      const rect = canvas.getBoundingClientRect();
      const fx = (clientX - rect.left) / (rect.width || size.w);
      const fy = (clientY - rect.top) / (rect.height || size.h);
      setView((current) => {
        const percent = Math.max(25, Math.min(400, current.zoom * factor));
        const w = (size.w * 100) / percent;
        const h = (size.h * 100) / percent;
        return {
          x: current.x + (current.w - w) * fx,
          y: current.y + (current.h - h) * fy,
          w,
          h,
          zoom: percent,
        };
      });
    }
    const wheel = (event: WheelEvent) => {
      if (event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      // Avoid changing the coordinate system during a table/connection drag.
      if (drag.current || gestureScale !== null) return;
      const size = viewport();
      const unitX =
        event.deltaMode === 2 ? size.w : event.deltaMode === 1 ? 16 : 1;
      const unitY =
        event.deltaMode === 2 ? size.h : event.deltaMode === 1 ? 16 : 1;
      const dx = event.deltaX * unitX;
      const dy = event.deltaY * unitY;
      // Trackpad pinch is delivered as Ctrl+wheel in Chromium and Firefox.
      if (event.ctrlKey) {
        zoomAt(Math.exp(-dy * 0.01), event.clientX, event.clientY);
        return;
      }
      setView((current) => ({
        ...current,
        x: current.x + (dx * current.w) / size.w,
        y: current.y + (dy * current.h) / size.h,
      }));
    };
    // WebKit also exposes native gesture events with cumulative scale.
    type CanvasGesture = Event & {
      scale?: number;
      clientX?: number;
      clientY?: number;
    };
    const gestureStart = (event: CanvasGesture) => {
      event.preventDefault();
      gestureScale = event.scale && event.scale > 0 ? event.scale : 1;
    };
    const gestureChange = (event: CanvasGesture) => {
      if (gestureScale === null) return;
      event.preventDefault();
      const scale = event.scale;
      if (!scale || !Number.isFinite(scale) || scale <= 0) return;
      const factor = scale / gestureScale;
      gestureScale = scale;
      if (drag.current) return;
      const rect = canvas.getBoundingClientRect();
      zoomAt(
        factor,
        event.clientX ?? rect.left + viewport().w / 2,
        event.clientY ?? rect.top + viewport().h / 2,
      );
    };
    const gestureEnd = (event: Event) => {
      if (gestureScale === null) return;
      event.preventDefault();
      gestureScale = null;
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("gesturestart", gestureStart, { passive: false });
    canvas.addEventListener("gesturechange", gestureChange, { passive: false });
    canvas.addEventListener("gestureend", gestureEnd, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("gesturestart", gestureStart);
      canvas.removeEventListener("gesturechange", gestureChange);
      canvas.removeEventListener("gestureend", gestureEnd);
    };
  }, []);
  function point(e: PointerEvent): Point {
    const matrix = svg.current!.getScreenCTM();
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix!.inverse(),
    );
  }
  function capture(e: PointerEvent, d: Drag) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = d;
    svg.current!.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const size = viewport();
      setView({
        ...d.view,
        x: d.view.x - ((e.clientX - d.start.x) * d.view.w) / size.w,
        y: d.view.y - ((e.clientY - d.start.y) * d.view.h) / size.h,
      });
      return;
    }
    const pos = point(e);
    if (d.kind === "link") {
      const hit = rowAt(pos);
      setLinking({
        from: d.from,
        origin: d.origin,
        to: pos,
        target: hit && hit.table !== d.from.table ? hit : null,
      });
      return;
    }
    const next = structuredClone(p.state);
    if (d.kind === "table") {
      const t = next.tables.find((t) => t.id === d.id)!;
      t.x = d.x + pos.x - d.start.x;
      t.y = d.y + pos.y - d.start.y;
      if (Math.abs(t.x) > 50000 || Math.abs(t.y) > 50000) return;
      if (!d.moved && Math.hypot(pos.x - d.start.x, pos.y - d.start.y) < 3)
        return;
      d.moved = true;
      if (overlaps(t, next.tables)) {
        p.onHint("他のテーブルと重なる位置には移動できません。");
        return;
      }
      p.onHint("");
    } else {
      const edge = next.edges.find((e) => e.id === d.id)!;
      edge.trunk = Math.max(d.min, Math.min(d.max, pos.x));
      edge.manual = true;
    }
    latest.current.onPreview(next);
  }
  function end(cancel = false) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (svg.current!.hasPointerCapture(d.pointer))
      svg.current!.releasePointerCapture(d.pointer);
    if (d.kind === "link") {
      const target = linking?.target;
      setLinking(null);
      if (!cancel && target) p.onLink?.(d.from, target);
      return;
    }
    if (d.kind === "table" && !d.moved) {
      if (!cancel) p.onSelectTable?.(d.id);
      return;
    }
    if (d.kind !== "pan") {
      if (cancel) p.onPreview(d.before);
      else p.onCommit(latest.current.state, d.before);
    }
  }
  const focused = p.selectedTable ?? null;
  const related = new Set<string>();
  if (focused)
    for (const e of p.state.edges)
      if (e.from.table === focused || e.to.table === focused) {
        related.add(`${e.from.table}:${e.from.row}`);
        related.add(`${e.to.table}:${e.to.row}`);
      }
  const selectedRoute = p.selected ? routes.get(p.selected) : undefined,
    h = p.adjustingLine ? selectedRoute?.handle : undefined;
  useEffect(() => {
    p.onAdjustable?.(!!selectedRoute?.handle);
  }, [selectedRoute, p.onAdjustable]);
  function moveLine(x: number) {
    const next = structuredClone(p.state),
      edge = next.edges.find((e) => e.id === p.selected);
    if (!edge || !h) return;
    edge.trunk = Math.max(h.min, Math.min(h.max, x));
    edge.manual = true;
    p.onCommit(next);
  }
  return (
    <div id="canvas" className={linking ? "linking" : undefined}>
      <svg
        ref={svg}
        id="diagram"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        aria-label="ER図の編集キャンバス"
        onPointerMove={move}
        onPointerUp={() => end()}
        onPointerCancel={() => end(true)}
        onLostPointerCapture={() => end(true)}
      >
        <defs>
          <pattern
            id="grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.8" className="grid-dot" />
          </pattern>
        </defs>
        <rect
          id="backdrop"
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.h}
          fill="url(#grid)"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            p.onClear();
            capture(e, {
              kind: "pan",
              start: { x: e.clientX, y: e.clientY },
              view,
              pointer: e.pointerId,
            });
          }}
        />
        <g id="edges">
          {p.state.edges.map((edge) => {
            const r = routes.get(edge.id)!,
              d = rounded(r.points),
              child = p.state.tables.find((t) => t.id === edge.to.table)!,
              fk = child.foreignKeys?.find((f) => f.id === edge.foreignKeyId),
              label = labels.get(edge.id);
            return (
              <g
                key={edge.id}
                className={`edge${p.state.edges.find((e) => e.id === p.selected)?.foreignKeyId === edge.foreignKeyId ? " selected" : ""}${focused && (edge.from.table === focused || edge.to.table === focused) ? " related" : ""}`}
                tabIndex={0}
                role="button"
                aria-label={`${p.displayTable(p.state.tables.find((t) => t.id === edge.from.table)!)}から${p.displayTable(p.state.tables.find((t) => t.id === edge.to.table)!)}への接続線`}
                onPointerDown={(e) => {
                  if (e.button === 0) e.preventDefault();
                }}
                onClick={() => p.onSelect(edge.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    p.onSelect(edge.id);
                  }
                }}
              >
                <path d={d} className="edge-hit" />
                <path d={d} className="edge-path" />
                {fk && (
                  <RelationshipDecorations
                    child={child}
                    fk={fk}
                    from={r.points[0]}
                    to={r.points.at(-1)!}
                    fromSide={r.fromSide ?? edge.from.side}
                    toSide={r.toSide ?? edge.to.side}
                  />
                )}
                {label && (
                  <g
                    className="relationship-label"
                    transform={`translate(${label.x} ${label.y})`}
                  >
                    <rect width={label.width} height={label.height} rx={3} />
                    <text x={label.width / 2} textAnchor="middle">
                      {label.lines.map((line, i) => (
                        <tspan key={i} x={label.width / 2} y={14 + i * 16}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
        <g id="tables">
          {p.state.tables.map((t) => {
            const width = tableWidth(t);
            return (
              <g
                key={t.id}
                data-table={t.id}
                className={`table${focused === t.id ? " selected" : ""}`}
                transform={`translate(${t.x} ${t.y})`}
              >
                <rect
                  width={width}
                  height={height(t)}
                  rx={9}
                  className="table-box"
                />
                <g
                  className="table-heading"
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.displayTable(t)}を移動。矢印キーで移動できます。`}
                  onPointerDown={(e) =>
                    capture(e, {
                      kind: "table",
                      id: t.id,
                      start: point(e),
                      x: t.x,
                      y: t.y,
                      before: p.state,
                      pointer: e.pointerId,
                    })
                  }
                  onDoubleClick={() => beginRename(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      beginRename(t);
                      return;
                    }
                    if (
                      ![
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key)
                    )
                      return;
                    e.preventDefault();
                    const n = e.shiftKey ? 24 : 8,
                      next = structuredClone(p.state),
                      table = next.tables.find((x) => x.id === t.id)!;
                    table.x +=
                      e.key === "ArrowLeft"
                        ? -n
                        : e.key === "ArrowRight"
                          ? n
                          : 0;
                    table.y +=
                      e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
                    if (
                      !overlaps(table, next.tables) &&
                      Math.abs(table.x) <= 50000 &&
                      Math.abs(table.y) <= 50000
                    )
                      p.onCommit(next);
                  }}
                >
                  <title>{`${t.logicalName ? t.logicalName + " / " : ""}${t.name ?? t.id}`}</title>
                  <path
                    d={`M9 1H${width - 9}Q${width - 1} 1 ${width - 1} 9V${HEADER}H1V9Q1 1 9 1`}
                  />
                  <line
                    x1={1}
                    x2={width - 1}
                    y1={HEADER - 0.5}
                    y2={HEADER - 0.5}
                    className="table-divider"
                  />
                  <text
                    x={16}
                    y={31}
                    className="table-title"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onSelectTable?.(t.id);
                    }}
                  >
                    {p.displayTable(t)}
                  </text>
                </g>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.displayTable(t)}を編集`}
                  className="edit-table"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => p.onEdit(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      p.onEdit(t.id);
                    }
                  }}
                >
                  <title>テーブルを編集</title>
                  <rect x={width - 40} y={12} width={28} height={28} rx={6} />
                  {[-5, 0, 5].map((dx) => (
                    <circle
                      key={dx}
                      cx={width - 26 + dx}
                      cy={26}
                      r={1.4}
                      className="edit-dot"
                    />
                  ))}
                </g>
                {t.columns.map((c, i) => {
                  const y = HEADER + i * ROW;
                  return (
                    <g
                      key={c.id}
                      className={`row${!c.key ? " non-key" : ""}${p.pending?.table === t.id && p.pending.row === i ? " pending" : ""}${related.has(`${t.id}:${i}`) ? " related" : ""}${linking && ((linking.from.table === t.id && linking.from.row === i) || (linking.target?.table === t.id && linking.target.row === i)) ? " link-end" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${p.displayTable(t)}.${p.displayColumn(c)} を接続`}
                      onClick={() => p.onSelectTable?.(t.id)}
                      onDoubleClick={() => beginRename(t, c)}
                      onKeyDown={(e) => {
                        if (e.key === "F2") {
                          e.preventDefault();
                          beginRename(t, c);
                          return;
                        }
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          p.onConnect(t.id, i);
                        }
                      }}
                    >
                      <title>{`${c.logicalName ? c.logicalName + " / " : ""}${c.name} · ${c.type} ${c.key}`}</title>
                      <rect
                        x={1}
                        y={y}
                        width={width - 2}
                        height={ROW}
                        className="row-bg"
                      />
                      {c.key && (
                        <g
                          className={`column-key ${c.key === "PK" ? "pk" : c.key === "FK" ? "fk" : "pkfk"}`}
                        >
                          <rect
                            x={9}
                            y={y + ROW / 2 - 8}
                            width={c.key === "PK,FK" ? 26 : 24}
                            height={16}
                            rx={4}
                          />
                          <text
                            x={c.key === "PK,FK" ? 22 : 21}
                            y={y + ROW / 2 + 3.5}
                            textAnchor="middle"
                          >
                            {c.key === "PK,FK" ? "P/F" : c.key}
                          </text>
                        </g>
                      )}
                      <text x={41} y={y + 24} className="column-name">
                        {p.displayColumn(c)}
                      </text>
                      <text
                        x={width - 14}
                        y={y + 24}
                        textAnchor="end"
                        className="column-type"
                      >
                        {c.type}
                      </text>
                      {(["left", "right"] as const).map((side) => (
                        <g key={side}>
                          <circle
                            cx={side === "left" ? 0 : width}
                            cy={y + ROW / 2}
                            r={4}
                            className="port"
                          />
                          <circle
                            cx={side === "left" ? 0 : width}
                            cy={y + ROW / 2}
                            r={10}
                            className="port-hit"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => {
                              const origin = {
                                x: t.x + (side === "left" ? 0 : width),
                                y: t.y + y + ROW / 2,
                              };
                              capture(e, {
                                kind: "link",
                                from: { table: t.id, row: i },
                                origin,
                                pointer: e.pointerId,
                              });
                              if (drag.current?.kind === "link")
                                setLinking({
                                  from: { table: t.id, row: i },
                                  origin,
                                  to: origin,
                                  target: null,
                                });
                            }}
                          >
                            <title>
                              ドラッグして別のテーブルのカラムへ接続
                            </title>
                          </circle>
                        </g>
                      ))}
                    </g>
                  );
                })}
                {renaming?.table === t.id && (
                  <foreignObject
                    x={8}
                    y={
                      renaming.columnId
                        ? HEADER +
                          t.columns.findIndex(
                            (c) => c.id === renaming.columnId,
                          ) *
                            ROW
                        : 0
                    }
                    width={width - 16}
                    height={100}
                    style={{ overflow: "visible" }}
                  >
                    <form
                      className="inline-name"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onSubmit={(e) => {
                        e.preventDefault();
                        try {
                          p.onRename?.(
                            renaming.table,
                            renaming.columnId,
                            renaming.value,
                          );
                          setRenaming(null);
                        } catch (error) {
                          setRenameError(
                            error instanceof Error
                              ? error.message
                              : String(error),
                          );
                        }
                      }}
                    >
                      <label>
                        {p.logical ? "論理名" : "物理名"}{" "}
                        <input
                          autoFocus
                          aria-label={
                            p.logical
                              ? "図上で論理名を編集"
                              : "図上で物理名を編集"
                          }
                          required={!p.logical}
                          maxLength={80}
                          value={renaming.value}
                          onChange={(e) =>
                            setRenaming({ ...renaming, value: e.target.value })
                          }
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setRenaming(null);
                            }
                            if (e.key === "Enter" && e.nativeEvent.isComposing)
                              e.preventDefault();
                          }}
                        />
                      </label>
                      <small>Enterで確定・Escでキャンセル</small>
                      {renameError && (
                        <p role="alert" className="error">
                          {renameError}
                        </p>
                      )}
                    </form>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </g>
        {linking && (
          <path
            className={`link-preview${linking.target ? " ready" : ""}`}
            d={`M${linking.origin.x} ${linking.origin.y}L${linking.to.x} ${linking.to.y}`}
          />
        )}
        <g id="handles">
          {h && (
            <>
              {Math.abs(h.y2 - h.y1) > 40 && (
                <line
                  x1={h.x}
                  y1={Math.min(h.y1, h.y2) + 12}
                  x2={h.x}
                  y2={Math.max(h.y1, h.y2) - 12}
                  className="drag-guide"
                />
              )}
              <rect
                x={h.x - 6}
                y={h.y - 7}
                width={12}
                height={14}
                rx={2}
                className="drag-handle"
                tabIndex={0}
                role="slider"
                aria-label="線の通り道を左右に調整"
                aria-valuemin={Math.round(h.min)}
                aria-valuemax={Math.round(h.max)}
                aria-valuenow={Math.round(h.x)}
                onPointerDown={(e) =>
                  capture(e, {
                    kind: "edge",
                    id: p.selected!,
                    before: p.state,
                    pointer: e.pointerId,
                    min: h.min,
                    max: h.max,
                  })
                }
                onKeyDown={(e) => {
                  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                  e.preventDefault();
                  moveLine(h.x + (e.key === "ArrowLeft" ? -8 : 8));
                }}
              >
                <title>左右にドラッグ、または矢印キーで調整</title>
              </rect>
            </>
          )}
        </g>
      </svg>
      {p.children}
      <div className="zoom">
        <button id="fit" title="全体を表示" onClick={() => fit()}>
          <Icon name="fit" size={15} />
          全体を表示
        </button>
        <button
          aria-label="縮小"
          disabled={view.zoom <= 25}
          onClick={() =>
            zoom([...steps].reverse().find((n) => n < view.zoom - 0.01) ?? 25)
          }
        >
          <Icon name="minus" size={14} />
        </button>
        <button
          id="zoom-label"
          title="100%に戻す"
          aria-label={`拡大率 ${Math.round(view.zoom)}%。100%に戻す`}
          onClick={() => zoom(100)}
        >
          {Math.round(view.zoom)}%
        </button>
        <button
          aria-label="拡大"
          disabled={view.zoom >= 400}
          onClick={() => zoom(steps.find((n) => n > view.zoom + 0.01) ?? 400)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );
}
