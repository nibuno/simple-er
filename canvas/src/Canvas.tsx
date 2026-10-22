import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CanvasDocument, CanvasNode, Point, Tool, View } from "./types";
import {
  bounds,
  clone,
  expandedIds,
  intersects,
  minimumHeight,
  moveNodes,
  noteContent,
  VIEW_KEY,
} from "./model";
import { documentRoutes, routeEdge, sceneBounds } from "./geometry";
import { Icon } from "./Icons";
import { InlineEditor } from "./Inspector";
import { ShapeTextEditor } from "./ShapeTextEditor";
import type { ShapeTextField } from "./ShapeTextEditor";
import { boxTextArea, shapeLabels, shapePaths } from "./shapes";
import { nodeAppearance } from "./colors";

export interface CanvasHandle {
  fit: () => void;
  center: () => Point;
  focus: () => void;
}
interface Props {
  doc: CanvasDocument;
  selection: string[];
  tool: Tool;
  pending: string | null;
  editing: string | null;
  draftId?: string;
  getDocument: () => CanvasDocument;
  onSelect: (ids: string[]) => void;
  onConnect: (id: string, from?: string) => void;
  onEdit: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<CanvasNode>) => void;
  onAddNote: (point: Point) => void;
  onPreview: (doc: CanvasDocument) => void;
  onCommit: (doc: CanvasDocument, before?: CanvasDocument) => void;
  onStatus: (value: string) => void;
  onDirty: () => void;
}
type Drag =
  | {
      kind: "move" | "resize";
      pointer: number;
      start: Point;
      before: CanvasDocument;
      ids: string[];
      id: string;
      moved: boolean;
      editField?: ShapeTextField;
    }
  | { kind: "pan"; pointer: number; start: Point; view: View }
  | { kind: "marquee"; pointer: number; start: Point; add: string[] }
  | { kind: "connect"; pointer: number; from: string };
function textField(target: EventTarget): ShapeTextField | undefined {
  const text = (target as Element).closest(".node-title,.node-description");
  if (!text) return undefined;
  return text.classList.contains("node-description") ? "description" : "title";
}
function readView(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
    if (
      v &&
      [v.x, v.y, v.zoom].every(Number.isFinite) &&
      v.zoom >= 0.05 &&
      v.zoom <= 3
    )
      return v;
  } catch {}
  return null;
}
export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(p, ref) {
  const saved = useRef(readView()),
    stage = useRef<HTMLDivElement>(null),
    latest = useRef(p);
  latest.current = p;
  const [view, setView] = useState<View>(
      saved.current || { x: 40, y: 40, zoom: 1 },
    ),
    viewRef = useRef(view);
  viewRef.current = view;
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [wire, setWire] = useState<{ from: string; end: Point } | null>(null);
  const [editedSize, setEditedSize] = useState<{
    id: string;
    h: number;
  } | null>(null);
  const editTarget = useRef<ShapeTextField>("title"),
    editView = useRef<{ before: View; focused: View } | null>(null);
  const drag = useRef<Drag | null>(null),
    space = useRef(false),
    [panning, setPanning] = useState(false);
  const displayedDoc = useMemo(
    () =>
      editedSize && p.editing === editedSize.id
        ? {
            ...p.doc,
            nodes: p.doc.nodes.map((n) =>
              n.id === editedSize.id ? { ...n, h: editedSize.h } : n,
            ),
          }
        : p.doc,
    [p.doc, p.editing, editedSize],
  );
  const routes = useMemo(() => documentRoutes(displayedDoc), [displayedDoc]);
  const toWorld = (x: number, y: number) => {
    const r = stage.current!.getBoundingClientRect(),
      v = viewRef.current;
    return { x: (x - r.left - v.x) / v.zoom, y: (y - r.top - v.y) / v.zoom };
  };
  const fitZoom = (b: { w: number; h: number }, w: number, h: number) =>
    Math.max(
      0.05,
      Math.min(1, (w - 100) / Math.max(b.w, 1), (h - 110) / Math.max(b.h, 1)),
    );
  function fit() {
    const el = stage.current;
    // Without a size the zoom would clamp to 5% and then be stored.
    if (!el?.clientWidth || !el.clientHeight) return;
    const b = sceneBounds(latest.current.doc),
      w = el.clientWidth,
      h = el.clientHeight,
      zoom = fitZoom(b, w, h);
    setView({
      zoom,
      x: (w - b.w * zoom) / 2 - b.x * zoom,
      y: (h - b.h * zoom) / 2 - b.y * zoom,
    });
  }
  // The first layout can happen before the stage has a size (a hidden pane),
  // so the initial view is settled once it has one. A stored view is kept
  // unless it hides the whole drawing or is far smaller than fitting it.
  const initialView = useRef(true);
  function settleInitialView() {
    const el = stage.current;
    if (!initialView.current || !el?.clientWidth || !el.clientHeight) return;
    initialView.current = false;
    const v = saved.current,
      doc = latest.current.doc;
    if (v && !doc.nodes.length) return;
    if (v) {
      const b = sceneBounds(doc),
        visible = intersects(
          {
            x: b.x * v.zoom + v.x,
            y: b.y * v.zoom + v.y,
            w: Math.max(b.w * v.zoom, 1),
            h: Math.max(b.h * v.zoom, 1),
          },
          { x: 0, y: 0, w: el.clientWidth, h: el.clientHeight },
        );
      if (visible && v.zoom >= fitZoom(b, el.clientWidth, el.clientHeight) / 4)
        return;
    }
    fit();
  }
  useImperativeHandle(ref, () => ({
    fit,
    center: () =>
      toWorld(
        stage.current!.getBoundingClientRect().left +
          stage.current!.clientWidth / 2,
        stage.current!.getBoundingClientRect().top +
          stage.current!.clientHeight / 2,
      ),
    focus: () => stage.current?.focus(),
  }));
  function revealSelection() {
    const el = stage.current,
      props = latest.current;
    if (
      !el?.clientWidth ||
      drag.current ||
      props.editing ||
      props.selection.length !== 1
    )
      return;
    const node = props.doc.nodes.find((n) => n.id === props.selection[0]);
    if (!node) return;
    setView((v) => {
      const left = node.x * v.zoom + v.x,
        right = (node.x + node.w) * v.zoom + v.x;
      const top = node.y * v.zoom + v.y,
        bottom = (node.y + node.h) * v.zoom + v.y;
      const dx =
        left < 24 || node.w * v.zoom > el.clientWidth - 48
          ? 24 - left
          : right > el.clientWidth - 24
            ? el.clientWidth - 24 - right
            : 0;
      const dy =
        top < 24 || node.h * v.zoom > el.clientHeight - 92
          ? 24 - top
          : bottom > el.clientHeight - 68
            ? el.clientHeight - 68 - bottom
            : 0;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }
  useLayoutEffect(() => {
    settleInitialView();
    const resize = new ResizeObserver(() => {
      settleInitialView();
      revealSelection();
    });
    resize.observe(stage.current!);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {}
  }, [view]);
  useEffect(() => {
    if (!stage.current) return;
    if (!p.editing) {
      const previous = editView.current,
        current = viewRef.current;
      if (
        previous &&
        current.x === previous.focused.x &&
        current.y === previous.focused.y &&
        current.zoom === previous.focused.zoom
      )
        setView(previous.before);
      editView.current = null;
      return;
    }
    const n = p.doc.nodes.find((n) => n.id === p.editing);
    if (!n) return;
    const el = stage.current;
    if (n.kind === "box") {
      const before = viewRef.current;
      editView.current = { before, focused: before };
      return;
    }
    setView((v) => {
      const left = n.x * v.zoom + v.x,
        right = left + Math.max(240, Math.min(320, n.w)),
        top = n.y * v.zoom + v.y;
      const dx =
        left < 24
          ? 24 - left
          : right > el.clientWidth - 24
            ? el.clientWidth - 24 - right
            : 0;
      const dy =
        top < 40
          ? 40 - top
          : top > el.clientHeight - 260
            ? Math.max(24, el.clientHeight - 260) - top
            : 0;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }, [p.editing]);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !editedSize || editedSize.id !== p.editing) return;
    const node = p.doc.nodes.find((n) => n.id === p.editing);
    if (!node || editedSize.h <= node.h) return;
    const current = viewRef.current,
      top = node.y * current.zoom + current.y,
      bottom = top + editedSize.h * current.zoom;
    const dy =
      top < 24
        ? 24 - top
        : bottom > el.clientHeight - 128
          ? el.clientHeight - 128 - bottom
          : 0;
    if (!dy) return;
    const next = { ...current, y: current.y + dy },
      previous = editView.current;
    if (
      previous &&
      current.x === previous.focused.x &&
      current.y === previous.focused.y &&
      current.zoom === previous.focused.zoom
    )
      previous.focused = next;
    setView(next);
  }, [p.editing, editedSize, view.zoom]);
  function zoomTo(zoom: number, cx?: number, cy?: number) {
    if (!stage.current) return;
    const old = viewRef.current,
      x = cx ?? stage.current.clientWidth / 2,
      y = cy ?? stage.current.clientHeight / 2,
      next = Math.max(0.05, Math.min(3, zoom));
    setView({
      zoom: next,
      x: x - ((x - old.x) * next) / old.zoom,
      y: y - ((y - old.y) * next) / old.zoom,
    });
  }
  useEffect(() => {
    const el = stage.current!;
    let gesture = 1;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea,input")) return;
      e.preventDefault();
      if (drag.current) return;
      const v = viewRef.current,
        r = el.getBoundingClientRect(),
        factor =
          e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? el.clientHeight : 1;
      if (e.ctrlKey || e.metaKey)
        zoomTo(
          v.zoom * Math.exp(-e.deltaY * factor * 0.006),
          e.clientX - r.left,
          e.clientY - r.top,
        );
      else
        setView({
          ...v,
          x: v.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * factor,
          y: v.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * factor,
        });
    };
    const start = (e: Event) => {
      e.preventDefault();
      gesture = (e as Event & { scale: number }).scale || 1;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale: number }).scale || 1;
      zoomTo((viewRef.current.zoom * scale) / gesture);
      gesture = scale;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", start, { passive: false });
    el.addEventListener("gesturechange", change, { passive: false });
    const down = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(e.target as HTMLElement).closest("input,textarea,select,button")
      ) {
        e.preventDefault();
        space.current = true;
        setPanning(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        space.current = false;
        setPanning(false);
      }
    };
    const blur = () => {
      space.current = false;
      setPanning(false);
      cancel();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", start);
      el.removeEventListener("gesturechange", change);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, []);
  function capture(e: ReactPointerEvent) {
    stage.current!.setPointerCapture(e.pointerId);
  }
  function startPan(e: ReactPointerEvent) {
    e.preventDefault();
    drag.current = {
      kind: "pan",
      pointer: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      view: viewRef.current,
    };
    capture(e);
    setPanning(true);
  }
  function startNode(e: ReactPointerEvent, node: CanvasNode, resize = false) {
    if (e.button !== 0 && e.button !== 1) return;
    e.stopPropagation();
    if (e.button === 1 || space.current || p.tool === "pan") {
      startPan(e);
      return;
    }
    if (!resize && (p.tool === "connect" || p.pending)) {
      e.preventDefault();
      p.onConnect(node.id);
      return;
    }
    if (p.editing === node.id) return;
    if (p.editing) {
      stage.current?.focus();
      p.onSelect([node.id]);
      return;
    }
    // A click selects; clicking the text of the already selected figure, or
    // double-clicking it, edits that field.
    const editField =
      !resize &&
      !e.shiftKey &&
      p.selection.length === 1 &&
      p.selection[0] === node.id
        ? textField(e.target)
        : undefined;
    e.preventDefault();
    stage.current?.focus();
    const ids = e.shiftKey
      ? p.selection.includes(node.id)
        ? p.selection.filter((id) => id !== node.id)
        : [...p.selection, node.id]
      : p.selection.includes(node.id)
        ? p.selection
        : [node.id];
    // Defer opening the panel for a text click, so it cannot move the target
    // between pointer-down and pointer-up. A drag still selects and moves it.
    if (!editField) p.onSelect(ids);
    if (!ids.includes(node.id)) return;
    drag.current = {
      kind: resize ? "resize" : "move",
      pointer: e.pointerId,
      start: toWorld(e.clientX, e.clientY),
      before: p.getDocument(),
      ids,
      id: node.id,
      moved: false,
      editField,
    };
    capture(e);
  }
  function cancel() {
    const d = drag.current;
    if (d && (d.kind === "move" || d.kind === "resize"))
      latest.current.onCommit(d.before, d.before);
    drag.current = null;
    setMarquee(null);
    setWire(null);
    setPanning(false);
    if (d && stage.current?.hasPointerCapture(d.pointer))
      stage.current.releasePointerCapture(d.pointer);
  }
  function end(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if ((d.kind === "move" || d.kind === "resize") && d.moved)
      latest.current.onCommit(latest.current.doc, d.before);
    if (d.kind === "move" && !d.moved && d.editField) {
      editTarget.current = d.editField;
      latest.current.onEdit(d.id);
    }
    if (d.kind === "marquee") {
      const end = toWorld(e.clientX, e.clientY),
        r = {
          x: Math.min(d.start.x, end.x),
          y: Math.min(d.start.y, end.y),
          w: Math.abs(d.start.x - end.x),
          h: Math.abs(d.start.y - end.y),
        };
      const ids = latest.current.doc.nodes
        .filter((n) => n.kind !== "group" && intersects(n, r))
        .map((n) => n.id);
      latest.current.onSelect([...new Set([...d.add, ...ids])]);
    }
    if (d.kind === "connect") {
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (target && target !== d.from) latest.current.onConnect(target, d.from);
      else latest.current.onConnect(d.from);
    }
    setMarquee(null);
    setWire(null);
    setPanning(false);
    if (stage.current?.hasPointerCapture(d.pointer))
      stage.current.releasePointerCapture(d.pointer);
    if ((d.kind === "move" || d.kind === "resize") && (d.moved || !d.editField))
      requestAnimationFrame(revealSelection);
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const point = toWorld(e.clientX, e.clientY);
    if (d.kind === "pan") {
      setView({
        ...d.view,
        x: d.view.x + e.clientX - d.start.x,
        y: d.view.y + e.clientY - d.start.y,
      });
      return;
    }
    if (d.kind === "connect") {
      setWire({ from: d.from, end: point });
      return;
    }
    if (d.kind === "marquee") {
      setMarquee({
        x: Math.min(d.start.x, point.x),
        y: Math.min(d.start.y, point.y),
        w: Math.abs(point.x - d.start.x),
        h: Math.abs(point.y - d.start.y),
      });
      return;
    }
    let dx = point.x - d.start.x,
      dy = point.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 4) return;
    if (!d.moved && d.editField) p.onSelect(d.ids);
    d.moved = true;
    if (!e.altKey) {
      dx = Math.round(dx / 8) * 8;
      dy = Math.round(dy / 8) * 8;
    }
    if (d.kind === "move") p.onPreview(moveNodes(d.before, d.ids, dx, dy));
    else {
      const next = clone(d.before),
        n = next.nodes.find((n) => n.id === d.id)!;
      n.w = Math.max(160, Math.min(4000, n.w + dx));
      n.h = Math.max(minimumHeight(n, next), Math.min(20000, n.h + dy));
      p.onPreview(next);
    }
  }
  const expanded = expandedIds(p.doc, p.selection);
  const renderNode = (original: CanvasNode) => {
    const node =
      editedSize?.id === original.id && p.editing === original.id
        ? { ...original, h: editedSize.h }
        : original;
    const selected = p.selection.includes(node.id),
      text = noteContent(node, p.doc),
      editing = p.editing === node.id,
      area = boxTextArea(node),
      paths = shapePaths(node),
      colors = nodeAppearance(node, p.doc),
      name =
        node.title ||
        text.title ||
        (node.kind === "box"
          ? shapeLabels[node.shape]
          : node.kind === "group"
            ? "囲み"
            : "メモ");
    return (
      <div
        key={node.id}
        data-node-id={node.id}
        data-node-kind={node.kind}
        data-node-shape={node.shape}
        className={
          "canvas-node " +
          node.kind +
          (selected ? " selected" : "") +
          (editing ? " editing" : "") +
          (expanded.has(node.id) ? " in-selection" : "") +
          (p.pending === node.id ? " connecting" : "")
        }
        style={
          {
            left: node.x,
            top: node.y,
            width: node.w,
            height: node.h,
            "--node-fill": node.fillColor,
            "--node-stroke": node.strokeColor,
            "--node-text": colors.text,
            "--node-muted": colors.muted,
          } as CSSProperties
        }
      >
        {editing && node.kind === "box" ? (
          <>
            <svg
              className="shape-outline"
              viewBox={`0 0 ${node.w} ${node.h}`}
              aria-hidden="true"
            >
              <path className="shape-fill" d={paths.outline} />
              {paths.detail && (
                <path className="shape-detail" d={paths.detail} />
              )}
            </svg>
            <ShapeTextEditor
              node={node}
              doc={p.doc}
              target={editTarget.current}
              isNew={p.draftId === node.id}
              zoom={view.zoom}
              onDirty={p.onDirty}
              onSize={(height) => {
                const h = Math.min(
                  Math.max(original.h, height),
                  Math.max(
                    180,
                    ((stage.current?.clientHeight || 500) - 152) / view.zoom,
                  ),
                );
                setEditedSize((current) =>
                  current?.id === node.id && current.h === h
                    ? current
                    : { id: node.id, h },
                );
              }}
              onCancel={() => {
                editTarget.current = "title";
                setEditedSize(null);
                p.onEdit(null);
                stage.current?.focus();
              }}
              onFinish={(patch) => {
                editTarget.current = "title";
                setEditedSize(null);
                p.onPatch(node.id, patch);
                p.onEdit(null);
                stage.current?.focus();
              }}
            />
          </>
        ) : editing ? (
          <InlineEditor
            node={node}
            doc={p.doc}
            isNew={p.draftId === node.id}
            onDirty={p.onDirty}
            zoom={view.zoom}
            maxHeight={Math.max(140, (stage.current?.clientHeight || 500) - 48)}
            onCancel={() => {
              p.onEdit(null);
              stage.current?.focus();
            }}
            onFinish={(patch) => {
              p.onPatch(node.id, patch);
              p.onEdit(null);
              stage.current?.focus();
            }}
          />
        ) : (
          <>
            <button
              className="node-face"
              aria-label={name + "を選択"}
              aria-pressed={selected}
              onPointerDown={(e) => startNode(e, node)}
              onDoubleClick={(e) => {
                if (p.editing === node.id) return;
                editTarget.current =
                  (node.kind === "box" && textField(e.target)) || "title";
                p.onEdit(node.id);
              }}
              onClick={(e) => {
                if (e.detail === 0) {
                  if (p.pending || p.tool === "connect") p.onConnect(node.id);
                  else p.onSelect([node.id]);
                }
              }}
            >
              {node.kind === "box" ? (
                <>
                  <svg
                    className="shape-outline"
                    viewBox={`0 0 ${node.w} ${node.h}`}
                    aria-hidden="true"
                  >
                    <path className="shape-fill" d={paths.outline} />
                    {paths.detail && (
                      <path className="shape-detail" d={paths.detail} />
                    )}
                  </svg>
                  <span
                    className={"box-text" + (area.centered ? " centered" : "")}
                    style={{
                      left: area.x,
                      top: area.y,
                      width: area.w,
                      height: area.h,
                    }}
                  >
                    {node.title && (
                      <span className="node-title">{node.title}</span>
                    )}
                    {node.description && (
                      <span className="node-description">
                        {node.description}
                      </span>
                    )}
                  </span>
                  {node.body && (
                    <span
                      className="memo-indicator"
                      aria-label="メモあり"
                      style={
                        node.shape === "rectangle"
                          ? undefined
                          : {
                              right: node.w / 2 - 6,
                              bottom:
                                node.shape === "cylinder" ? 12 : area.y / 2 + 4,
                            }
                      }
                    >
                      <Icon name="note" />
                    </span>
                  )}
                </>
              ) : node.kind === "note" ? (
                <>
                  {text.title && (
                    <span className="note-title">{text.title}</span>
                  )}
                  <span className="note-body">{text.body}</span>
                </>
              ) : (
                <>
                  <span className="node-title">
                    {node.title || "無題の囲み"}
                  </span>
                </>
              )}
            </button>
            {selected && (
              <button
                className="node-edit"
                aria-label={name + "を編集"}
                onClick={() => p.onEdit(node.id)}
              >
                編集
              </button>
            )}
            {selected && (
              <button
                className="resize-handle"
                aria-label="サイズを変更。矢印キーでも調整できます"
                onPointerDown={(e) => startNode(e, node, true)}
                onKeyDown={(e) => {
                  if (!e.key.startsWith("Arrow")) return;
                  e.stopPropagation();
                  e.preventDefault();
                  p.onPatch(node.id, {
                    w: Math.max(
                      160,
                      node.w +
                        (e.key === "ArrowRight"
                          ? 16
                          : e.key === "ArrowLeft"
                            ? -16
                            : 0),
                    ),
                    h: Math.max(
                      60,
                      node.h +
                        (e.key === "ArrowDown"
                          ? 16
                          : e.key === "ArrowUp"
                            ? -16
                            : 0),
                    ),
                  });
                }}
              />
            )}
            {node.kind !== "group" && (
              <button
                className="connection-port"
                aria-label={name + "から接続"}
                title="ドラッグ、またはクリックして接続先を選択"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  stage.current?.focus();
                  drag.current = {
                    kind: "connect",
                    pointer: e.pointerId,
                    from: node.id,
                  };
                  setWire({
                    from: node.id,
                    end: toWorld(e.clientX, e.clientY),
                  });
                  capture(e);
                }}
                onClick={(e) => {
                  if (e.detail === 0) p.onConnect(node.id);
                }}
              />
            )}
          </>
        )}
      </div>
    );
  };
  return (
    <div
      className={"canvas-stage tool-" + p.tool + (panning ? " is-panning" : "")}
      ref={stage}
      tabIndex={0}
      aria-label="設計キャンバス"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 1) return;
        if (
          (e.target as Element).closest(
            ".canvas-node,.edge-control,.canvas-controls,.empty-canvas",
          )
        )
          return;
        if (e.button === 1 || space.current || p.tool === "pan") {
          startPan(e);
          return;
        }
        if (p.tool === "connect") {
          p.onStatus("接続元の図形またはメモを選んでください。");
          return;
        }
        stage.current?.focus();
        drag.current = {
          kind: "marquee",
          pointer: e.pointerId,
          start: toWorld(e.clientX, e.clientY),
          add: e.shiftKey ? p.selection : [],
        };
        if (!e.shiftKey) p.onSelect([]);
        capture(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (drag.current) cancel();
      }}
      onDoubleClick={(e) => {
        if (
          !(e.target as Element).closest(
            ".canvas-node,.edge-control,.canvas-controls,.empty-canvas",
          )
        )
          p.onAddNote(toWorld(e.clientX, e.clientY));
      }}
    >
      <div
        className="canvas-dots"
        style={{
          backgroundSize: 24 * view.zoom + "px " + 24 * view.zoom + "px",
          backgroundPosition: view.x + "px " + view.y + "px",
        }}
      />
      <div
        className="world frame-world"
        style={{
          transform:
            "translate(" +
            view.x +
            "px," +
            view.y +
            "px) scale(" +
            view.zoom +
            ")",
        }}
      >
        {p.doc.nodes.filter((n) => n.kind === "group").map(renderNode)}
      </div>
      <svg className="connections" aria-label="要素の接続線">
        <defs>
          <marker
            id="canvas-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1 9 5 1 9"
              fill="none"
              stroke="context-stroke"
              strokeWidth="1.5"
            />
          </marker>
        </defs>
        <g
          transform={
            "translate(" + view.x + "," + view.y + ") scale(" + view.zoom + ")"
          }
        >
          {p.doc.nodes
            .filter((n) => n.attachedTo)
            .map((n) => (
              <path
                key={n.id}
                className="attachment-wire"
                d={
                  routeEdge(
                    {
                      id: n.id,
                      from: n.attachedTo!,
                      to: n.id,
                      label: "",
                      dashed: true,
                    },
                    p.doc.nodes,
                  ).path
                }
              />
            ))}
          {p.doc.edges.map((edge) => {
            const route = routes.get(edge.id)!;
            return (
              <g
                key={edge.id}
                className={
                  "edge-control" +
                  (p.selection.includes(edge.id) ? " selected" : "")
                }
                role="button"
                style={{ "--edge-stroke": edge.strokeColor } as CSSProperties}
                tabIndex={0}
                aria-label={
                  (p.doc.nodes.find((n) => n.id === edge.from)?.title ||
                    "メモ") +
                  "から" +
                  (p.doc.nodes.find((n) => n.id === edge.to)?.title || "メモ") +
                  "への接続線"
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onSelect(
                    e.shiftKey
                      ? [...new Set([...p.selection, edge.id])]
                      : [edge.id],
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    p.onSelect([edge.id]);
                  }
                }}
              >
                <path className="edge-hit" d={route.path} />
                <path
                  className="edge-visible"
                  d={route.path}
                  strokeDasharray={edge.dashed ? "7 5" : undefined}
                  markerEnd="url(#canvas-arrow)"
                />
                {edge.label && (
                  <text
                    className="edge-label"
                    x={route.label.x}
                    y={route.label.y - 8}
                    textAnchor="middle"
                  >
                    {route.labelLines.map((line, i) => (
                      <tspan key={i} x={route.label.x} dy={i ? 18 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                )}
              </g>
            );
          })}
          {wire && (
            <path
              className="pending-wire"
              d={
                "M " +
                (p.doc.nodes.find((n) => n.id === wire.from)!.x +
                  p.doc.nodes.find((n) => n.id === wire.from)!.w) +
                " " +
                (p.doc.nodes.find((n) => n.id === wire.from)!.y +
                  p.doc.nodes.find((n) => n.id === wire.from)!.h / 2) +
                " L " +
                wire.end.x +
                " " +
                wire.end.y
              }
            />
          )}
          {marquee && (
            <rect
              className="marquee"
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
            />
          )}
        </g>
      </svg>
      <div
        className="world node-world"
        style={{
          transform:
            "translate(" +
            view.x +
            "px," +
            view.y +
            "px) scale(" +
            view.zoom +
            ")",
        }}
      >
        {p.doc.nodes.filter((n) => n.kind !== "group").map(renderNode)}
      </div>
      {!p.doc.nodes.length && (
        <div className="empty-canvas">
          <span className="empty-symbol">
            <Icon name="box" />
          </span>
          <h2>キャンバスは空です</h2>
          <p>上のボタンから図形やメモを追加できます。</p>
          <button
            className="primary"
            onClick={() => p.onAddNote({ x: 100, y: 100 })}
          >
            メモを追加
          </button>
          <small>余白のダブルクリックでも書き始められます</small>
        </div>
      )}
      <div className="canvas-controls" aria-label="表示操作">
        <button aria-label="全体を表示" title="全体を表示 (1)" onClick={fit}>
          <Icon name="fit" />
        </button>
        <span className="control-divider" />
        <button aria-label="縮小" onClick={() => zoomTo(view.zoom / 1.2)}>
          <Icon name="minus" />
        </button>
        <button
          className="zoom-value"
          aria-label="100%に戻す"
          onClick={() => zoomTo(1)}
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button aria-label="拡大" onClick={() => zoomTo(view.zoom * 1.2)}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
});
