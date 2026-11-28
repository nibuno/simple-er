import type { LinkEntry } from "../../shared/diagram-links.ts";
import { isImeKey } from "../../shared/ime.ts";
import { TextField } from "../../shared/TextField.tsx";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  CanvasDocument,
  CanvasNode,
  CanvasEdge,
  MemoStatus,
} from "./types";
import { arrowheadLabels, memoStatusLabels } from "./types";
import { MAX_TEXT, noteContent } from "./model";
import { Icon, NODE_ICONS, NodeIcon } from "./Icons";
import { minimumWidth, SHAPES, shapeIcons, shapeLabels } from "./shapes";
import { ColorPicker } from "./ColorPicker";
import { DEFAULT_COLORS } from "./colors";

export type Panel =
  "shape" | "icon" | "color" | "memo" | "label" | "more" | "er";
// Actions for the selection sit in a bar just above it; anything with more
// than a click behind it opens in a small panel under the bar.
export function SelectionBar({
  flushInput,
  doc,
  node,
  edge,
  count,
  selection,
  sharedSite,
  erEntries,
  selectedEr,
  onOpenEr,
  onLinkEr,
  onColors,
  onPatch,
  onEdge,
  onDelete,
  onDuplicate,
  onGroup,
  onAttach,
  onFitGroup,
  onSelect,
  request,
}: {
  sharedSite: boolean;
  erEntries: LinkEntry[];
  selectedEr?: string;
  onOpenEr: (node: CanvasNode) => void;
  onLinkEr: (key: string) => void;
  flushInput: () => void;
  doc: CanvasDocument;
  node?: CanvasNode;
  edge?: CanvasEdge;
  // A panel to open right away, such as the label after double-clicking a line.
  request?: { id: string; panel: Panel } | null;
  count: number;
  selection: string[];
  onColors: (
    patch: Pick<Partial<CanvasNode>, "fillColor" | "strokeColor">,
  ) => void;
  onPatch: (id: string, patch: Partial<CanvasNode>) => void;
  onEdge: (id: string, patch: Partial<CanvasEdge>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onAttach: (id: string) => void;
  onFitGroup: (id: string) => void;
  onSelect: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState<Panel | null>(null);
  const key = selection.join(",");
  useEffect(
    () => setOpen(request && request.id === key ? request.panel : null),
    [key, request],
  );
  if (!count) return null;
  const parent = node?.attachedTo
    ? doc.nodes.find((n) => n.id === node.attachedTo)
    : undefined;
  const patch = (changes: Partial<CanvasNode>) =>
    node && onPatch(node.id, changes);
  const nodes = doc.nodes.filter((n) => selection.includes(n.id));
  const elements = [
    ...nodes,
    ...doc.edges.filter((e) => selection.includes(e.id)),
  ];
  const sharedColor = (
    items: typeof elements,
    key: "fillColor" | "strokeColor",
  ) => {
    const first =
      items[0] && key in items[0] ? (items[0] as CanvasNode)[key] : undefined;
    return {
      value: first,
      mixed: items.some((item) => (item as CanvasNode)[key] !== first),
    };
  };
  const fill = sharedColor(nodes, "fillColor"),
    stroke = sharedColor(elements, "strokeColor");
  const toggle = (panel: Panel) => {
    flushInput();
    setOpen(open === panel ? null : panel);
  };
  const panelButton = (panel: Panel, label: string, content: ReactNode) => (
    <button
      className={"bar-button" + (open === panel ? " open" : "")}
      aria-label={label}
      data-tip={label}
      aria-expanded={open === panel}
      onClick={() => toggle(panel)}
    >
      {content}
    </button>
  );
  // The button shows the color itself: a figure's fill inside its line, or
  // a line's own color.
  const colorButton = panelButton(
    "color",
    "色",
    <>
      <span
        className="bar-swatch"
        style={
          {
            "--swatch-fill": nodes.length
              ? (fill.value !== "transparent" && fill.value) || "var(--surface)"
              : stroke.value || "var(--shape-line)",
            "--swatch-stroke": stroke.value || "var(--shape-line)",
          } as CSSProperties
        }
      />
      <span>色</span>
    </>,
  );
  const hasGroups = doc.nodes.some((n) => n.kind === "group");
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="選択した要素の操作"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open && !isImeKey(e.nativeEvent)) {
          e.stopPropagation();
          flushInput();
          setOpen(null);
        }
      }}
    >
      <div className="bar-row">
        {parent && (
          <button
            className="bar-button text"
            onClick={() => onSelect([parent.id])}
          >
            {(parent.title || shapeLabels[parent.shape]) + "のメモ"}
          </button>
        )}
        {node?.kind === "box" &&
          panelButton("shape", "図形", <Icon name={shapeIcons[node.shape]} />)}
        {node?.kind === "box" &&
          panelButton(
            "icon",
            "アイコン",
            node.icon ? <NodeIcon id={node.icon} /> : <Icon name="smile" />,
          )}
        {edge &&
          panelButton(
            "label",
            "ラベル",
            <>
              <Icon name="label" />
              <span>{edge.label ? "ラベル" : "ラベルを追加"}</span>
            </>,
          )}
        {colorButton}
        {edge && (
          <>
            <select
              className="bar-arrowheads"
              aria-label="矢印の種類"
              title="矢印の種類"
              value={edge.arrowheads ?? "end"}
              onChange={(e) =>
                onEdge(edge.id, {
                  arrowheads: e.target.value as keyof typeof arrowheadLabels,
                })
              }
            >
              {Object.entries(arrowheadLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="bar-button"
              aria-label="破線"
              data-tip="破線"
              aria-pressed={edge.dashed}
              onClick={() => onEdge(edge.id, { dashed: !edge.dashed })}
            >
              <Icon name="dashed" />
            </button>
            <button
              className="bar-button"
              aria-label="向きを反転"
              disabled={
                edge.arrowheads === "both" || edge.arrowheads === "none"
              }
              data-tip="向きを反転"
              onClick={() => onEdge(edge.id, { from: edge.to, to: edge.from })}
            >
              <Icon name="swap" />
            </button>
          </>
        )}
        {(node?.kind === "box" || parent) &&
          panelButton(
            "memo",
            "メモを開く",
            <>
              <Icon name="note" />
              <span>メモ</span>
            </>,
          )}
        {node?.kind === "box" && panelButton("er", "ER 図", "ER 図")}
        {count > 1 && (
          <button
            className="bar-button"
            aria-label="囲む"
            data-tip="囲む ⌘G"
            onClick={onGroup}
          >
            <Icon name="group" />
          </button>
        )}
        {node?.kind === "group" && (
          <button
            className="bar-button"
            aria-label="内容に合わせる"
            data-tip="内容に合わせる"
            onClick={() => onFitGroup(node.id)}
          >
            <Icon name="fit" />
          </button>
        )}
        <span className="bar-divider" />
        {!edge && (
          <button
            className="bar-button"
            aria-label="複製"
            data-tip="複製 ⌘D"
            onClick={onDuplicate}
          >
            <Icon name="duplicate" />
          </button>
        )}
        <button
          className="bar-button danger"
          aria-label={node?.kind === "group" ? "囲みを解除" : "削除"}
          data-tip={node?.kind === "group" ? "囲みを解除" : "削除 Delete"}
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
        {node &&
          (node.kind !== "box" || hasGroups) &&
          panelButton("more", "その他", <Icon name="more" />)}
      </div>
      {open && (
        <div
          className={"bar-panel" + (open === "memo" ? " memo-editor" : "")}
          key={open}
        >
          {open === "er" && node && (
            <div className="er-picker">
              <label className="field">
                リンク先の ER 図
                <select
                  value={selectedEr ?? (node.erLink ? "missing" : "")}
                  onChange={(event) => onLinkEr(event.target.value)}
                >
                  <option value="">リンクなし</option>
                  {node.erLink && !selectedEr && (
                    <option disabled value="missing">
                      図が見つかりません
                    </option>
                  )}
                  {sharedSite &&
                    erEntries.map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.title}
                      </option>
                    ))}
                </select>
              </label>
              {!sharedSite ? (
                <p>
                  連携するには、SimpleER を起動して 8765 の /canvas/
                  を開いてください。8766 や Web 版の図は別々に保存されます。
                </p>
              ) : !erEntries.length ? (
                <p>
                  この保存先には ER 図がありません。Web
                  版とローカル版の図は別々に保存されます。
                  <a href="../" target="_blank" rel="noopener">
                    SimpleER を開く
                  </a>
                </p>
              ) : selectedEr ? (
                <button
                  type="button"
                  className="open-er"
                  onClick={() => onOpenEr(node)}
                >
                  SimpleER で開く
                </button>
              ) : (
                <p>このブラウザの同じ保存先にある図を選べます。</p>
              )}
            </div>
          )}
          {open === "icon" && node && (
            <div
              className="icon-choice"
              role="radiogroup"
              aria-label="アイコン"
            >
              <button
                role="radio"
                aria-checked={!node.icon}
                aria-label="アイコンなし"
                title="なし"
                onClick={() => patch({ icon: undefined })}
              >
                <Icon name="close" />
              </button>
              {NODE_ICONS.map((icon) => (
                <button
                  key={icon.id}
                  role="radio"
                  aria-checked={node.icon === icon.id}
                  aria-label={icon.label}
                  title={icon.label}
                  onClick={() => patch({ icon: icon.id })}
                >
                  <NodeIcon id={icon.id} />
                </button>
              ))}
            </div>
          )}
          {open === "shape" && node && (
            <div className="shape-choice" role="radiogroup" aria-label="図形">
              {SHAPES.map((shape) => (
                <button
                  key={shape}
                  role="radio"
                  aria-checked={node.shape === shape}
                  aria-label={shapeLabels[shape]}
                  title={shapeLabels[shape]}
                  onClick={() => patch({ shape })}
                >
                  <Icon name={shapeIcons[shape]} />
                </button>
              ))}
            </div>
          )}
          {open === "color" && (
            <>
              {!!nodes.length && (
                <ColorPicker
                  label="塗り"
                  kind="fill"
                  {...fill}
                  defaultColor={
                    nodes[0].kind === "group"
                      ? DEFAULT_COLORS.frame
                      : nodes[0].kind === "note"
                        ? "transparent"
                        : DEFAULT_COLORS.fill
                  }
                  onChange={(fillColor) => onColors({ fillColor })}
                />
              )}
              <ColorPicker
                label="線"
                kind="stroke"
                {...stroke}
                defaultColor={
                  nodes.length ? DEFAULT_COLORS.stroke : DEFAULT_COLORS.line
                }
                onChange={(strokeColor) => onColors({ strokeColor })}
              />
            </>
          )}
          {open === "memo" && node && (
            <>
              <label className="field memo-status-field">
                <span>状態</span>
                <select
                  aria-label="メモの状態"
                  value={(parent || node).memoStatus || ""}
                  onChange={(e) =>
                    onPatch((parent || node).id, {
                      memoStatus: (e.target.value || undefined) as
                        MemoStatus | undefined,
                    })
                  }
                >
                  <option value="">未設定</option>
                  {Object.entries(memoStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                label="メモ"
                value={parent ? parent.body : node.body}
                onCommit={(body) => onPatch(parent?.id || node.id, { body })}
                multiline
                maxLength={MAX_TEXT}
                autoFocus
              />
              {node.kind === "box" && (
                <button
                  className="secondary full"
                  onClick={() => onAttach(node.id)}
                >
                  {doc.nodes.some((n) => n.attachedTo === node.id)
                    ? "図のメモを選択"
                    : "図に表示"}
                </button>
              )}
            </>
          )}
          {open === "label" && edge && (
            <TextField
              label="線のラベル"
              value={edge.label}
              onCommit={(label) => onEdge(edge.id, { label })}
              autoFocus
            />
          )}
          {open === "more" && node && (
            <>
              {node.kind === "note" && !parent && (
                <button
                  className="secondary full"
                  onClick={() =>
                    patch({
                      kind: "box",
                      title:
                        node.title || node.body.split("\n")[0].slice(0, 80),
                    })
                  }
                >
                  箱にする
                </button>
              )}
              {(node.kind === "group" || (node.kind === "note" && !parent)) && (
                <TextField
                  label="見出し"
                  value={node.title}
                  onCommit={(title) => patch({ title })}
                />
              )}
              {node.kind !== "group" && hasGroups && (
                <label className="field">
                  <span>囲み</span>
                  <select
                    aria-label="所属する囲み"
                    value={node.groupId || ""}
                    onChange={(e) =>
                      patch({ groupId: e.target.value || undefined })
                    }
                  >
                    <option value="">なし</option>
                    {doc.nodes
                      .filter((n) => n.kind === "group")
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title || "無題の囲み"}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </>
          )}
          {node &&
            ((open === "more" && node.kind !== "box") ||
              (open === "shape" && node.kind === "box")) && (
              <div className="size-fields">
                {(["w", "h"] as const).map((key, i) => (
                  <label key={key}>
                    {i ? "高さ" : "幅"}
                    <input
                      type="number"
                      aria-label={i ? "高さ" : "幅"}
                      min={i ? 50 : minimumWidth(node.shape)}
                      max={i ? 20000 : 4000}
                      step="10"
                      value={Math.round(node[key])}
                      onChange={(e) => {
                        const value = e.target.valueAsNumber;
                        if (!Number.isFinite(value)) return;
                        const size = Math.max(
                          i && node.shape !== "circle"
                            ? 50
                            : minimumWidth(node.shape),
                          Math.min(i ? 20000 : 4000, value),
                        );
                        // A circle's width and height move together.
                        patch(
                          node.shape === "circle"
                            ? { w: size, h: size }
                            : { [key]: size },
                        );
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// Text, a figure's memo, and a group's heading are written in place: one
// field where the words appear, in the same type, without a form around it.
export function InlineEditor({
  node,
  doc,
  onFinish,
}: {
  node: CanvasNode;
  doc: CanvasDocument;
  onFinish: (patch: Partial<CanvasNode>) => void;
}) {
  const content = noteContent(node, doc),
    done = useRef(false),
    composing = useRef(false),
    field = node.kind === "group" ? "title" : "body";
  function finish(form: HTMLFormElement) {
    if (done.current) return;
    done.current = true;
    onFinish({ [field]: String(new FormData(form).get(field) || "") });
  }
  return (
    <form
      className={"inline-editor in-place " + node.kind}
      aria-label="図の上で編集"
      onSubmit={(e) => {
        e.preventDefault();
        finish(e.currentTarget);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) finish(e.currentTarget);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (composing.current || isImeKey(e.nativeEvent)) return;
        // Esc confirms, like Enter with ⌘; undo takes the words back.
        if (
          e.key === "Escape" ||
          (e.key === "Enter" &&
            (e.metaKey || e.ctrlKey || node.kind === "group"))
        ) {
          e.preventDefault();
          finish(e.currentTarget);
        }
      }}
    >
      {node.kind === "group" ? (
        <input
          aria-label="見出しを直接編集"
          name="title"
          defaultValue={node.title}
          placeholder="囲みの見出し"
          maxLength={200}
          autoFocus
        />
      ) : (
        <>
          {content.title && (
            <span className="note-title">
              {node.attachedTo && <Icon name="note" />}
              {content.title}
            </span>
          )}
          <textarea
            aria-label={
              node.attachedTo ? "メモを直接編集" : "テキストを直接編集"
            }
            name="body"
            defaultValue={content.body}
            placeholder={node.attachedTo ? "メモを入力" : "テキストを入力"}
            maxLength={MAX_TEXT}
            autoFocus
            rows={Math.max(2, content.body.split("\n").length + 1)}
            onInput={(e) => {
              const area = e.currentTarget;
              area.style.height = "auto";
              area.style.height = area.scrollHeight + "px";
            }}
          />
        </>
      )}
    </form>
  );
}
