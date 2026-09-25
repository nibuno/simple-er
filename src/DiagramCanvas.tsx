import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode, RefObject } from "react";
import type { Column, Diagram, Endpoint, Point, Table, View } from "./types.ts";
import { height, HEADER, ROW, rounded, route, tableWidth } from "./geometry.ts";
import { overlaps } from "./utils.ts";

interface Props {
  state: Diagram;
  selected: string | null;
  pending: Endpoint | null;
  displayTable: (t: Table) => string;
  displayColumn: (c: Column) => string;
  onEdit: (id: string) => void;
  onConnect: (table: string, row: number) => void;
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
    }
  | {
      kind: "edge";
      id: string;
      min: number;
      max: number;
      before: Diagram;
      pointer: number;
    }
  | { kind: "pan"; start: Point; view: View; pointer: number };
const steps = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400];
export function DiagramCanvas(p: Props) {
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null);
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
    () => new Map(p.state.edges.map((e) => [e.id, route(e, p.state.tables)])),
    [p.state],
  );
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
    const x = Math.min(...tables.map((t) => t.x)) - 70,
      y = Math.min(...tables.map((t) => t.y)) - 80;
    const right = Math.max(...tables.map((t) => t.x + tableWidth(t))) + 70,
      bottom = Math.max(...tables.map((t) => t.y + height(t))) + 100,
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
        return { ...v, x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
      });
    });
    observer.observe(svg.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (p.fitRequest) fit();
  }, [p.fitRequest]);
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
    const pos = point(e),
      next = structuredClone(p.state);
    if (d.kind === "table") {
      const t = next.tables.find((t) => t.id === d.id)!;
      t.x = d.x + pos.x - d.start.x;
      t.y = d.y + pos.y - d.start.y;
      if (Math.abs(t.x) > 50000 || Math.abs(t.y) > 50000) return;
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
    if (d.kind !== "pan") {
      if (cancel) p.onPreview(d.before);
      else p.onCommit(latest.current.state, d.before);
    }
  }
  const selectedRoute = p.selected ? routes.get(p.selected) : undefined,
    h = selectedRoute?.handle;
  function moveLine(x: number) {
    const next = structuredClone(p.state),
      edge = next.edges.find((e) => e.id === p.selected);
    if (!edge || !h) return;
    edge.trunk = Math.max(h.min, Math.min(h.max, x));
    edge.manual = true;
    p.onCommit(next);
  }
  return (
    <div id="canvas">
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
              d = rounded(r.points);
            return (
              <g
                key={edge.id}
                className={`edge${p.selected === edge.id ? " selected" : ""}`}
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
                {[r.points[0], r.points.at(-1)!].map((pos, i) => (
                  <circle
                    key={i}
                    cx={pos.x}
                    cy={pos.y}
                    r={3.5}
                    className="endpoint"
                  />
                ))}
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
                  onDoubleClick={() => p.onEdit(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      p.onEdit(t.id);
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
                    d={`M9 0H${width - 9}Q${width} 0 ${width} 9V${HEADER}H0V9Q0 0 9 0`}
                  />
                  <text x={16} y={31} className="table-title">
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
                  <rect x={width - 50} y={10} width={44} height={32} rx={4} />
                  <text x={width - 28} y={30} textAnchor="middle">
                    編集
                  </text>
                </g>
                {t.columns.map((c, i) => {
                  const y = HEADER + i * ROW;
                  return (
                    <g
                      key={c[3]}
                      className={`row${!c[2] ? " non-key" : ""}${p.pending?.table === t.id && p.pending.row === i ? " pending" : ""}`}
                      tabIndex={c[2] ? 0 : -1}
                      role={c[2] ? "button" : "group"}
                      aria-label={`${p.displayTable(t)}.${p.displayColumn(c)}${c[2] ? " を接続" : ""}`}
                      onClick={() => p.onConnect(t.id, i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          p.onConnect(t.id, i);
                        }
                      }}
                    >
                      <title>{`${c[4] ? c[4] + " / " : ""}${c[0]} · ${c[1]} ${c[2]}`}</title>
                      <rect
                        x={1}
                        y={y}
                        width={width - 2}
                        height={ROW}
                        className="row-bg"
                      />
                      <text x={12} y={y + 24} className="column-key">
                        {c[2] === "PK,FK" ? "P/F" : c[2]}
                      </text>
                      <text x={39} y={y + 24} className="column-name">
                        {p.displayColumn(c)}
                      </text>
                      <text
                        x={width - 14}
                        y={y + 24}
                        textAnchor="end"
                        className="column-type"
                      >
                        {c[1]}
                      </text>
                      {c[2] &&
                        [0, width].map((x) => (
                          <circle
                            key={x}
                            cx={x}
                            cy={y + ROW / 2}
                            r={4}
                            className="port"
                          />
                        ))}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
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
                y={h.y - 16}
                width={12}
                height={32}
                rx={6}
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
        <button id="fit" onClick={() => fit()}>
          全体を表示
        </button>
        <button
          aria-label="縮小"
          disabled={view.zoom <= 25}
          onClick={() =>
            zoom([...steps].reverse().find((n) => n < view.zoom - 0.01) ?? 25)
          }
        >
          −
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
          ＋
        </button>
      </div>
    </div>
  );
}
