import { useTouchNavigation } from "../../shared/useTouchNavigation.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { VariantDialog } from "./VariantDialog";
import { Icon } from "./Icons";
import { toSvg, svgFrame } from "./export";
import { sceneRoutes } from "./geometry";
import { openDiagram, type DiagramEntry } from "./library";
import { bounds } from "./spatial";
import { memoStatusLabels, type CanvasDocument, type Point } from "./types";
import {
  compareDiagrams,
  previousVariantName,
  type Difference,
} from "./variants";

const styles = {
  added: { label: "追加", color: "#18845c", dash: "" },
  removed: { label: "削除", color: "#ba5053", dash: "9 5" },
  changed: { label: "変更", color: "#a36712", dash: "3 3" },
};
type Changes = ReturnType<typeof compareDiagrams>;

function preview(
  doc: CanvasDocument,
  routes: ReturnType<typeof sceneRoutes>,
  changes?: Changes,
) {
  const svg = toSvg(
    doc,
    [],
    routes,
    (node, content) => {
      const kind = changes?.nodes.get(node.id);
      if (!kind) return content;
      const { color, dash } = styles[kind];
      return (
        content +
        `<rect x="${node.x - 3}" y="${node.y - 3}" width="${node.w + 6}" height="${node.h + 6}" rx="5" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${dash}"/>`
      );
    },
    {
      transparent: true,
      followTheme: true,
      wrapEdge: (edge, content, path) => {
        const kind = changes?.edges.get(edge.id);
        if (!kind) return content;
        const { color, dash } = styles[kind];
        return (
          `<path d="${path}" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="${dash}"/>` +
          content
        );
      },
    },
  );
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(svg.replace(/[\uD800-\uDFFF]/gu, "\uFFFD"))
  );
}

function differences(
  left: CanvasDocument,
  right: CanvasDocument,
  changes: Changes,
) {
  const rows: { key: string; kind: Difference; text: string }[] = [];
  const leftNodes = new Map(left.nodes.map((n) => [n.id, n]));
  const rightNodes = new Map(right.nodes.map((n) => [n.id, n]));
  for (const [key, kind] of changes.nodes) {
    const a = leftNodes.get(key),
      b = rightNodes.get(key);
    const name = (b || a)!.title || "無題の図形";
    let text =
      a?.title && b?.title && a.title !== b.title
        ? a.title + " → " + b.title
        : name;
    if (a?.memoStatus !== b?.memoStatus) {
      const before = a?.memoStatus ? memoStatusLabels[a.memoStatus] : "未設定";
      const after = b?.memoStatus ? memoStatusLabels[b.memoStatus] : "未設定";
      text += `（メモ：${before} → ${after}）`;
    }
    if (a && b && a.body !== b.body)
      text += `（メモ本文：${a.body || "なし"} → ${b.body || "なし"}）`;
    rows.push({ key: "node-" + key, kind, text });
  }
  for (const [doc, nodes, removed] of [
    [right, rightNodes, false],
    [left, leftNodes, true],
  ] as const) {
    for (const edge of doc.edges) {
      const kind = changes.edges.get(edge.id);
      if (!kind || (kind === "removed") !== removed) continue;
      const text =
        (nodes.get(edge.from)?.title || "図形") +
        " → " +
        (nodes.get(edge.to)?.title || "図形");
      rows.push({
        key: "edge-" + edge.id,
        kind,
        text: edge.label ? text + "（" + edge.label + "）" : text,
      });
    }
  }
  return rows;
}

const defaultCamera = { x: 0, y: 0, zoom: 1 };
function Drawing({
  left,
  right,
}: {
  left: CanvasDocument;
  right: CanvasDocument;
}) {
  const [show, setShow] = useState(true);
  const [camera, setCamera] = useState(defaultCamera);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    scale: number;
    start: Point;
  } | null>(null);
  const panes = useRef<HTMLDivElement>(null);
  useTouchNavigation(panes, null, (start) => {
    drag.current = null;
    const rect = panes.current!.getBoundingClientRect();
    const pane = panes.current!.children[
      start.x < rect.width / 2 ? 0 : 1
    ] as SVGSVGElement;
    const bounds = pane.getBoundingClientRect();
    const cx = bounds.left + bounds.width / 2 - rect.left;
    const cy = bounds.top + bounds.height / 2 - rect.top;
    const scale = pane.getScreenCTM()?.a || 1;
    return (center, factor) => {
      const zoom = Math.max(0.25, Math.min(32, camera.zoom * factor));
      const nextScale = (scale * zoom) / camera.zoom;
      setCamera({
        x: camera.x + (start.x - cx) / scale - (center.x - cx) / nextScale,
        y: camera.y + (start.y - cy) / scale - (center.y - cy) / nextScale,
        zoom,
      });
    };
  });
  const changes = useMemo(() => compareDiagrams(left, right), [left, right]);
  const rows = useMemo(
    () => differences(left, right, changes),
    [left, right, changes],
  );
  const scenes = useMemo(
    () =>
      [left, right].map((doc) => {
        const routes = sceneRoutes(doc);
        return { doc, routes, frame: svgFrame(doc, routes) };
      }),
    [left, right],
  );
  const images = useMemo(
    () =>
      scenes.map((s) => preview(s.doc, s.routes, show ? changes : undefined)),
    [scenes, show, changes],
  );
  const frame = bounds(
    scenes.filter((s) => s.doc.nodes.length).map((s) => s.frame),
  );
  const width = frame.w / camera.zoom,
    height = frame.h / camera.zoom;
  const viewBox = [
    frame.x + (frame.w - width) / 2 + camera.x,
    frame.y + (frame.h - height) / 2 + camera.y,
    width,
    height,
  ].join(" ");
  function zoom(factor: number) {
    setCamera((c) => ({
      ...c,
      zoom: Math.max(0.25, Math.min(32, c.zoom * factor)),
    }));
  }
  return (
    <>
      <div className="variant-panes" ref={panes}>
        {scenes.map(({ doc, frame: f }, i) => (
          <svg
            key={i}
            className="variant-paper"
            tabIndex={0}
            role="img"
            aria-label={(i ? "右" : "左") + "の図：" + doc.title}
            viewBox={viewBox}
            onPointerDown={(e) => {
              if (e.button !== 0 || !e.isPrimary) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = {
                pointer: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                scale: e.currentTarget.getScreenCTM()?.a || 1,
                start: camera,
              };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d && d.pointer === e.pointerId)
                setCamera((c) => ({
                  ...c,
                  x: d.start.x - (e.clientX - d.x) / d.scale,
                  y: d.start.y - (e.clientY - d.y) / d.scale,
                }));
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(e) => {
              const delta: Record<string, Point> = {
                ArrowLeft: { x: -1, y: 0 },
                ArrowRight: { x: 1, y: 0 },
                ArrowUp: { x: 0, y: -1 },
                ArrowDown: { x: 0, y: 1 },
              };
              const step = delta[e.key];
              if (step) {
                e.preventDefault();
                setCamera((c) => ({
                  ...c,
                  x: c.x + (step.x * width) / 10,
                  y: c.y + (step.y * height) / 10,
                }));
              }
            }}
            onWheel={(e) => zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12)}
          >
            <defs>
              <pattern
                id={`comparison-grid-${i}`}
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M24 0H0V24"
                  fill="none"
                  stroke="var(--grid)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect
              x="-1000000"
              y="-1000000"
              width="2000000"
              height="2000000"
              fill={`url(#comparison-grid-${i})`}
            />
            <image x={f.x} y={f.y} width={f.w} height={f.h} href={images[i]} />
          </svg>
        ))}
      </div>
      <div className="variant-tools">
        <label>
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />{" "}
          違いを色で示す
        </label>
        <div>
          <button aria-label="縮小" onClick={() => zoom(1 / 1.25)}>
            <Icon name="minus" />
          </button>
          <button onClick={() => setCamera(defaultCamera)}>全体を表示</button>
          <button aria-label="拡大" onClick={() => zoom(1.25)}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {rows.length ? (
        <details className="variant-differences">
          <summary>
            違い {rows.length} 件{" "}
            <span>
              {(Object.keys(styles) as Difference[]).map((kind) => (
                <span
                  key={kind}
                  className="diff-label"
                  style={{ borderColor: styles[kind].color }}
                >
                  {styles[kind].label}{" "}
                  {rows.filter((r) => r.kind === kind).length}
                </span>
              ))}
            </span>
          </summary>
          <ul>
            {rows.map((row) => (
              <li key={row.key}>
                <span
                  className="diff-label"
                  style={{ borderColor: styles[row.kind].color }}
                >
                  {styles[row.kind].label}
                </span>{" "}
                {row.text}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="variant-no-diffs">図形と線に違いはありません。</p>
      )}
    </>
  );
}

export interface VariantPair {
  group: DiagramEntry[];
  rightKey: string;
}
export function VariantComparison({
  pair,
  onClose,
  onChoose,
}: {
  pair: VariantPair;
  onClose: () => void;
  onChoose: (
    primary: DiagramEntry,
    selected: DiagramEntry,
    other: DiagramEntry,
    reason: string,
  ) => void;
}) {
  const { group } = pair;
  const [keys, setKeys] = useState([group[0].key, pair.rightKey]);
  const [choosing, setChoosing] = useState<number | null>(null);
  const entries = keys.map((key) => group.find((e) => e.key === key)!);
  const [left, right] = useMemo(
    () =>
      keys.map((key) => {
        const entry = group.find((e) => e.key === key)!;
        return openDiagram(entry.key, entry.raw);
      }),
    [group, keys],
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="help-dialog variant-comparison"
      aria-labelledby="variant-title"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id="variant-title">案を比べる</h2>
        <button
          className="icon-button"
          aria-label="比較を閉じる"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="variant-selectors">
        {entries.map((entry, i) => (
          <div key={i}>
            <select
              aria-label={(i ? "右" : "左") + "の案"}
              value={entry.key}
              onChange={(e) => {
                const next = [...keys],
                  value = e.target.value;
                if (value === keys[1 - i]) next[1 - i] = keys[i];
                next[i] = value;
                setKeys(next);
              }}
            >
              {group.map((item, index) => (
                <option key={item.key} value={item.key}>
                  {item.title}
                  {index === 0 ? "（元の図）" : ""}
                </option>
              ))}
            </select>
            {entry.key !== group[0].key && (
              <button
                className="secondary"
                disabled={!!left.error || !!right.error}
                aria-label={entry.title + "を元の図にする"}
                onClick={() => setChoosing(i)}
              >
                この案に決める
              </button>
            )}
          </div>
        ))}
      </div>
      {choosing !== null && (
        <VariantDialog
          archiveName={previousVariantName(group)}
          defaultName={entries[choosing].title}
          onCancel={() => setChoosing(null)}
          onSubmit={(reason) =>
            onChoose(group[0], entries[choosing], entries[1 - choosing], reason)
          }
        />
      )}

      {left.error || right.error ? (
        <p role="alert">
          保存データを読み込めません。図の一覧から確認してください。
        </p>
      ) : (
        <Drawing key={JSON.stringify(keys)} left={left.doc} right={right.doc} />
      )}
    </dialog>
  );
}
