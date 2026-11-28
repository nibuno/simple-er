import { useTouchNavigation } from "../shared/useTouchNavigation.ts";
import { tableColors, type TableGroup } from "./types.ts";
import { columnMarks, serialBase } from "./column-attributes.ts";
import { isImeKey } from "../shared/ime.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PointerEvent, ReactNode, RefObject } from "react";
import type {
  Column,
  Diagram,
  Endpoint,
  Point,
  Route,
  Table,
  View,
} from "./types.ts";
import {
  diagramBounds,
  groupFrames,
  height,
  HEADER,
  ROW,
  rounded,
  tableWidth,
} from "./geometry.ts";
import { RelationshipDecorations } from "./RelationshipDecorations.tsx";
import { relationshipLabels } from "./relationships.ts";
import { MAX_COLUMNS } from "./model.ts";
import { messageOf, moveGroup, overlaps } from "./utils.ts";
import { Icon } from "./icons.tsx";
import type { TableReveal } from "./diagram-view.ts";

type NameTarget =
  { kind: "table" } | { kind: "column"; id: string } | { kind: "add" };

type NameAction = "enter" | "tab" | "blur";

interface Props {
  logical?: boolean;
  onSaveName: (table: Table, target: NameTarget, value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  state: Diagram;
  visible: Diagram;
  relatedTo: string | null;
  routes: Map<string, Route>;
  selected: string | null;
  multiSelection?: string[];
  onToggleTable?: (id: string) => void;
  onEditGroup?: (group: TableGroup) => void;
  selectedTable?: string | null;
  onSelectTable?: (id: string) => void;
  // `nearest` pans only as far as needed instead of centering the table.
  revealRequest?: TableReveal | null;
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
  onCommit: (next: Diagram) => void;
  onPreview: (next: Diagram | null, tableId?: string) => void;
  fitRequest: number;
  viewRef: RefObject<View>;
  children: ReactNode;
}
type Drag =
  | {
      kind: "group";
      group: TableGroup;
      base: Diagram;
      start: Point;
      pointer: number;
      next?: Diagram;
      moved?: boolean;
    }
  | {
      kind: "table";
      id: string;
      start: Point;
      x: number;
      y: number;
      next?: Diagram;
      pointer: number;
      moved?: boolean;
    }
  | {
      kind: "edge";
      id: string;
      min: number;
      max: number;
      next?: Diagram;
      pointer: number;
    }
  | { kind: "pan"; start: Point; view: View; pointer: number }
  | { kind: "link"; from: Endpoint; origin: Point; pointer: number };
const steps = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400];
const entryHeight = 52;
// Pan just enough to show this interval, keeping an oversized one at its start.
function nearest(
  start: number,
  size: number,
  from: number,
  span: number,
  margin: number,
) {
  if (start < from + margin || size > span - 2 * margin) return start - margin;
  return Math.max(from, start + size - span + margin);
}
export function DiagramCanvas(p: Props) {
  const [editing, setEditing] = useState<{
    table: string;
    target: NameTarget;
  } | null>(null);
  function beginRename(t: Table, c?: Column) {
    p.onSelectTable?.(t.id);
    setEditing({
      table: t.id,
      target: c ? { kind: "column", id: c.id } : { kind: "table" },
    });
  }
  useEffect(() => {
    setEditing((edit) => (edit?.table === p.selectedTable ? edit : null));
  }, [p.selectedTable]);
  useEffect(() => setEditing(null), [p.logical]);

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
    for (const t of latest.current.visible.tables) {
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
    const releaseFocus = (event: MouseEvent) => {
      const active = document.activeElement;
      if (
        event.button !== 0 ||
        !(event.target instanceof Node) ||
        !active ||
        active.contains(event.target) ||
        !svg.current?.contains(active)
      )
        return;
      if (
        active instanceof HTMLInputElement &&
        active.closest(".inline-name")
      ) {
        // A canvas press can clear selection or start a drag before native blur.
        // Finish the edit first, so the drag also sees the updated document.
        flushSync(() => active.blur());
        if (
          active.isConnected &&
          active.getAttribute("aria-invalid") === "true"
        ) {
          active.focus();
          event.preventDefault();
          event.stopPropagation();
        }
      } else if (active instanceof SVGElement && event.type === "pointerdown") {
        active.blur();
      }
    };
    document.addEventListener("pointerdown", releaseFocus, true);
    document.addEventListener("click", releaseFocus, true);
    return () => {
      document.removeEventListener("pointerdown", releaseFocus, true);
      document.removeEventListener("click", releaseFocus, true);
    };
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
  function beginAdd(t: Table, row = t.columns.length) {
    setEditing({ table: t.id, target: { kind: "add" } });
    // Keep the next input in view as the table grows.
    const top = t.y + HEADER + row * ROW;
    setView((v) => {
      const x = nearest(t.x, tableWidth(t), v.x, v.w, 12);
      const y = nearest(top, entryHeight, v.y, v.h, 24);
      return x === v.x && y === v.y ? v : { ...v, x, y };
    });
  }
  const routes = p.routes;
  const latestRoutes = useRef(routes);
  latestRoutes.current = routes;
  const labels = useMemo(
    () => relationshipLabels(p.visible, routes),
    [p.visible, routes],
  );
  const latestLabels = useRef(labels);
  latestLabels.current = labels;
  function viewport() {
    return {
      w: Math.max(1, svg.current?.clientWidth ?? 1200),
      h: Math.max(1, svg.current?.clientHeight ?? 720),
    };
  }
  useTouchNavigation(svg, "foreignObject", (start) => {
    end(true);
    const initial = p.viewRef.current;
    const size = viewport();
    return (center, scale) => {
      const zoom = Math.max(25, Math.min(400, initial.zoom * scale));
      const w = (size.w * 100) / zoom,
        h = (size.h * 100) / zoom;
      setView({
        x: initial.x + (start.x * initial.w - center.x * w) / size.w,
        y: initial.y + (start.y * initial.h - center.y * h) / size.h,
        w,
        h,
        zoom,
      });
    };
  });
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
  function fit() {
    const tables = latest.current.visible.tables;
    if (!tables.length) {
      zoom(100, 0, 0);
      return;
    }
    const bounds = diagramBounds(tables, latestRoutes.current.values(), [
      ...latestLabels.current.values(),
      ...groupFrames(latest.current.visible),
    ]);
    const size = viewport();
    zoom(
      Math.min(
        1,
        size.w / (bounds.width + 140),
        size.h / (bounds.height + 180),
      ) * 100,
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2 + 10,
    );
  }
  useLayoutEffect(() => {
    fit();
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
  const unfilteredView = useRef<View | null>(null);
  useLayoutEffect(() => {
    if (p.relatedTo) {
      unfilteredView.current ??= view;
      fit();
    } else if (unfilteredView.current) {
      const previous = unfilteredView.current;
      unfilteredView.current = null;
      zoom(
        previous.zoom,
        previous.x + previous.w / 2,
        previous.y + previous.h / 2,
      );
    }
  }, [p.relatedTo]);
  useEffect(() => {
    if (p.fitRequest) fit();
  }, [p.fitRequest]);
  useEffect(() => {
    const t = p.revealRequest
      ? latest.current.state.tables.find((t) => t.id === p.revealRequest!.id)
      : undefined;
    if (!t) return;
    const matches = p.revealRequest?.matchedColumns;
    if (matches) {
      const size = viewport();
      const percent = Math.max(75, p.viewRef.current.zoom);
      const span = (size.h * 100) / percent;
      const row = t.columns.findIndex((c) => matches.includes(c.id));
      const centerY =
        row >= 0 && height(t) > span
          ? HEADER + (row + 0.5) * ROW
          : Math.min(height(t), span) / 2;
      zoom(percent, t.x + tableWidth(t) / 2, t.y + centerY);
      return;
    }
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
      if (p.revealRequest!.nearest) {
        return {
          ...v,
          x: nearest(t.x, w, v.x, v.w, margin),
          y: nearest(t.y, h, v.y, v.h, margin),
        };
      }
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
    // Touch implicitly captures the title. Keep it as the tap/double-tap target.
    if (
      e.pointerType !== "touch" ||
      !(e.target as Element).closest(".table-title")
    )
      svg.current!.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
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
    if (d.kind === "group") {
      const dx = pos.x - d.start.x,
        dy = pos.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      const next = moveGroup(d.base, d.group, dx, dy);
      if (!next) {
        p.onHint("他のテーブルと重なる位置や、図の範囲外には移動できません。");
        return;
      }
      p.onHint("");
      d.next = next;
    } else if (d.kind === "table") {
      const t = { ...p.state.tables.find((t) => t.id === d.id)! };
      t.x = d.x + pos.x - d.start.x;
      t.y = d.y + pos.y - d.start.y;
      if (Math.abs(t.x) > 50000 || Math.abs(t.y) > 50000) return;
      if (!d.moved && Math.hypot(pos.x - d.start.x, pos.y - d.start.y) < 3)
        return;
      d.moved = true;
      if (overlaps(t, p.state.tables)) {
        p.onHint("他のテーブルと重なる位置には移動できません。");
        return;
      }
      p.onHint("");
      d.next = {
        ...p.state,
        tables: p.state.tables.map((table) => (table.id === d.id ? t : table)),
      };
    } else {
      const trunk = Math.max(d.min, Math.min(d.max, pos.x));
      d.next = {
        ...p.state,
        edges: p.state.edges.map((edge) =>
          edge.id === d.id ? { ...edge, trunk, manual: true } : edge,
        ),
      };
    }
    p.onPreview(d.next, d.kind === "table" ? d.id : undefined);
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
    if (d.kind === "group" && !d.moved) {
      if (!cancel) p.onEditGroup?.(d.group);
      return;
    }
    if (d.kind === "table" && !d.moved) {
      if (!cancel) p.onSelectTable?.(d.id);
      return;
    }
    if (d.kind !== "pan") {
      if (!cancel && d.next) p.onCommit(d.next);
      else p.onPreview(null);
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
        style={{ "--screen-px": `${100 / view.zoom}px` } as React.CSSProperties}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        aria-label="ER図の編集キャンバス"
        onPointerMove={move}
        onPointerUp={(e) => {
          if (drag.current?.pointer === e.pointerId) end();
        }}
        onPointerCancel={(e) => {
          if (drag.current?.pointer === e.pointerId) end(true);
        }}
        onLostPointerCapture={(e) => {
          if (
            drag.current?.pointer === e.pointerId &&
            !svg.current?.hasPointerCapture(e.pointerId)
          )
            end(true);
        }}
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
        <g className="group-frames">
          {groupFrames(p.visible).map((f) => (
            <g key={f.group.id} transform={`translate(${f.x} ${f.y})`}>
              <rect
                className="group-border"
                rx={8}
                width={f.width}
                height={f.height}
              />
              <g
                className="group-heading"
                role="button"
                tabIndex={0}
                aria-label={`${f.group.name}の囲みを編集`}
                onPointerDown={(e) =>
                  capture(e, {
                    kind: "group",
                    group: f.group,
                    base: p.state,
                    start: point(e),
                    pointer: e.pointerId,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    p.onEditGroup?.(f.group);
                  }
                }}
              >
                <title>クリックで編集、ドラッグでまとめて移動</title>
                <rect width={f.width} height={36} fill="transparent" />
                <text x={14} y={25}>
                  {f.group.name}
                </text>
              </g>
            </g>
          ))}
        </g>
        <g id="edges">
          {p.visible.edges.map((edge) => {
            const r = routes.get(edge.id)!,
              d = rounded(r.points),
              child = p.state.tables.find((t) => t.id === edge.to.table)!,
              label = labels.get(edge.id);
            return (
              <g
                key={edge.id}
                className={`edge${p.selected === edge.id || (edge.foreignKeyId && p.state.edges.find((e) => e.id === p.selected)?.foreignKeyId === edge.foreignKeyId) ? " selected" : ""}${focused && (edge.from.table === focused || edge.to.table === focused) ? " related" : ""}`}
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
                <path
                  d={d}
                  className="edge-path"
                  strokeDasharray={
                    edge.entityRelation?.identifying === false
                      ? "5 4"
                      : undefined
                  }
                />
                <RelationshipDecorations
                  child={child}
                  edge={edge}
                  from={r.points[0]}
                  to={r.points.at(-1)!}
                  fromSide={r.fromSide ?? edge.from.side}
                  toSide={r.toSide ?? edge.to.side}
                />
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
          {p.visible.tables.map((t) => {
            const width = tableWidth(t);
            const selected = focused === t.id;
            const target =
              selected && editing?.table === t.id ? editing.target : null;
            const column =
              target?.kind === "column"
                ? t.columns.find((c) => c.id === target.id)
                : undefined;
            const rowEnd = HEADER + t.columns.length * ROW;
            const adding = target?.kind === "add";
            const initialName = adding
              ? ""
              : (column ?? t)[p.logical ? "logicalName" : "name"];
            const full = t.columns.length >= MAX_COLUMNS;
            return (
              <g
                key={t.id}
                data-table={t.id}
                className={`table${selected || p.multiSelection?.includes(t.id) ? " selected" : ""}`}
                onPointerDownCapture={(e) => {
                  if (e.shiftKey && e.button === 0) e.stopPropagation();
                }}
                onClickCapture={(e) => {
                  if (e.shiftKey) {
                    e.stopPropagation();
                    p.onToggleTable?.(t.id);
                  }
                }}
                transform={`translate(${t.x} ${t.y})`}
              >
                <rect
                  width={width}
                  height={
                    height(t) + (selected ? (adding ? entryHeight : ROW) : 0)
                  }
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
                  <title>{`${t.logicalName ? t.logicalName + " / " : ""}${t.name ?? t.id}${t.note ? "\n" + t.note : ""}`}</title>
                  <path
                    style={
                      t.color
                        ? {
                            fill: `light-dark(${tableColors[t.color].fill}, ${tableColors[t.color].dark})`,
                          }
                        : undefined
                    }
                    d={`M9 1H${width - 9}Q${width - 1} 1 ${width - 1} 9V${HEADER}H1V9Q1 1 9 1`}
                  />
                  <line
                    x1={1}
                    x2={width - 1}
                    y1={HEADER - 0.5}
                    y2={HEADER - 0.5}
                    className="table-divider"
                  />
                  {!!t.checks?.length && (
                    <text
                      x={width - 50}
                      y={31}
                      textAnchor="end"
                      className="table-schema"
                    >
                      <title>
                        {t.checks
                          .map((check) =>
                            [check.name, check.expression]
                              .filter(Boolean)
                              .join("："),
                          )
                          .join("\n")}
                      </title>
                      CHECK {t.checks.length}
                    </text>
                  )}
                  {t.schemaName && (
                    <text x={16} y={17} className="table-schema">
                      {t.schemaName}.
                    </text>
                  )}
                  <text
                    x={16}
                    y={t.schemaName ? 38 : 31}
                    className="table-title"
                    onPointerDown={(e) => {
                      if (e.pointerType !== "touch") e.stopPropagation();
                    }}
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
                  transform={`translate(${width - 26} 26)`}
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
                  <rect x={-14} y={-14} width={28} height={28} rx={6} />
                  {[-5, 0, 5].map((dx) => (
                    <circle
                      key={dx}
                      cx={dx}
                      cy={0}
                      r={1.4}
                      className="edit-dot"
                    />
                  ))}
                </g>
                {t.columns.map((c, i) => {
                  const y = HEADER + i * ROW;
                  const generated = c.identity || serialBase(c.type);
                  const marks = columnMarks(c, t);
                  const enumType = p.state.enums?.find(
                    (e) => e.name === c.type,
                  );
                  const tooltip = [
                    c.logicalName,
                    c.name + " · " + c.type,
                    c.key,
                    t.keys
                      .filter(
                        (k) =>
                          k.kind === "unique" && k.columnIds.includes(c.id),
                      )
                      .map(
                        (k) =>
                          "一意制約 " +
                          k.columnIds
                            .map(
                              (id) =>
                                t.columns.find((col) => col.id === id)?.name,
                            )
                            .join(", "),
                      )
                      .join("\n"),
                    enumType && "ENUM：" + enumType.values.join("、"),
                    c.notNull && "NOT NULL",
                    c.defaultValue && "既定値 " + c.defaultValue,
                    generated && "自動採番",
                    c.note,
                  ]
                    .filter(Boolean)
                    .join("\n");
                  const matched =
                    selected &&
                    p.revealRequest?.id === t.id &&
                    p.revealRequest.matchedColumns?.includes(c.id);
                  return (
                    <g
                      key={c.id}
                      data-search-match={matched || undefined}
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
                      <title>{tooltip}</title>
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
                        y={y + (marks ? 17 : 24)}
                        textAnchor="end"
                        className="column-type"
                        textDecoration={
                          enumType ? "underline dotted" : undefined
                        }
                      >
                        {c.type}
                      </text>
                      {marks && (
                        <text
                          className="column-marks"
                          x={width - 14}
                          y={y + 31}
                          textAnchor="end"
                        >
                          {marks}
                        </text>
                      )}
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
                              if (e.pointerType === "touch" && !selected) {
                                p.onSelectTable?.(t.id);
                                return;
                              }
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
                {selected && !adding && (
                  <foreignObject
                    x={8}
                    y={rowEnd + 4}
                    width={width - 16}
                    height={ROW}
                  >
                    <button
                      type="button"
                      className="inline-add-column"
                      aria-label={`${p.displayTable(t)}にカラムを追加`}
                      disabled={full}
                      title={full ? "カラムは60個までです" : undefined}
                      onClick={() => beginAdd(t)}
                    >
                      <Icon name="plus" size={14} />
                      カラム
                    </button>
                  </foreignObject>
                )}
                {target && (
                  <foreignObject
                    x={8}
                    y={
                      adding
                        ? rowEnd + 4
                        : column
                          ? HEADER + t.columns.indexOf(column) * ROW
                          : 0
                    }
                    width={width - 16}
                    height={100}
                    style={{ overflow: "visible", pointerEvents: "none" }}
                  >
                    <InlineNameEditor
                      key={
                        adding
                          ? `add-${t.columns.length}`
                          : column
                            ? `column-${column.id}`
                            : "table"
                      }
                      target={target}
                      logical={!!p.logical}
                      initialValue={initialName}
                      onSave={(value, action) => {
                        if (adding || value !== initialName)
                          p.onSaveName(t, target, value);
                        if (
                          action === "blur" ||
                          (action === "enter" && target.kind === "table")
                        ) {
                          setEditing(null);
                          return;
                        }
                        if (action === "tab" && !adding) {
                          const next =
                            t.columns[
                              column ? t.columns.indexOf(column) + 1 : 0
                            ];
                          if (next) {
                            beginRename(t, next);
                            return;
                          }
                        }
                        const count = t.columns.length + (adding ? 1 : 0);
                        if (count < MAX_COLUMNS) beginAdd(t, count);
                        else setEditing(null);
                      }}
                      onClose={() => setEditing(null)}
                      onUndo={p.onUndo}
                      onRedo={p.onRedo}
                    />
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

function InlineNameEditor({
  target,
  logical,
  initialValue,
  onSave,
  onClose,
  onUndo,
  onRedo,
}: {
  target: NameTarget;
  logical: boolean;
  initialValue: string;
  onSave: (value: string, action: NameAction) => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const typed = useRef(false);
  const adding = target.kind === "add";
  const field = logical ? "論理名" : "物理名";
  const finished = useRef(false);
  function save(input: HTMLInputElement, action: NameAction) {
    if (finished.current) return;
    const name = input.value.trim();
    if (!name && action !== "enter") {
      finished.current = true;
      onClose();
      return;
    }
    if ((adding && !name) || !input.reportValidity()) return;
    finished.current = true;
    try {
      onSave(name, action);
    } catch (err) {
      finished.current = false;
      setError(messageOf(err));
    }
  }
  return (
    <div className={`inline-name${adding ? " adding-column" : ""}`}>
      <label>
        {field}
        <input
          autoFocus
          aria-label={
            adding ? `追加するカラムの${field}` : `図上で${field}を編集`
          }
          aria-describedby="inline-name-hint"
          aria-invalid={error ? true : undefined}
          enterKeyHint={target.kind === "table" ? "done" : "next"}
          placeholder={adding ? "カラム名" : undefined}
          required={!logical && !adding}
          maxLength={80}
          value={value}
          onChange={(e) => {
            typed.current = true;
            setValue(e.target.value);
            setError("");
          }}
          onBlur={(e) => save(e.currentTarget, "blur")}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (isImeKey(e.nativeEvent)) return;
            if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
              e.preventDefault();
              save(e.currentTarget, e.key === "Enter" ? "enter" : "tab");
            } else if (e.key === "Escape") {
              e.preventDefault();
              finished.current = true;
              onClose();
            } else if (
              adding &&
              !typed.current &&
              (e.metaKey || e.ctrlKey) &&
              e.key.toLowerCase() === "z"
            ) {
              // A fresh row has no text history. Undo the last diagram edit.
              e.preventDefault();
              if (e.shiftKey) onRedo();
              else onUndo();
            }
          }}
        />
      </label>
      {error ? (
        <small id="inline-name-hint" role="alert" className="error">
          {error}
        </small>
      ) : (
        <small id="inline-name-hint">
          {target.kind === "table"
            ? "Enterで確定・Escでキャンセル"
            : "Enter で次へ・Esc で終了"}
        </small>
      )}
    </div>
  );
}
