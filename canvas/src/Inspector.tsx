import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { CanvasDocument, CanvasNode, CanvasEdge } from "./types";
import { MAX_TEXT, noteContent } from "./model";
import { Icon } from "./Icons";
import { SHAPES, shapeIcons, shapeLabels } from "./shapes";
import { ColorPicker } from "./ColorPicker";
import { DEFAULT_COLORS } from "./colors";

export function TextField({
  label,
  value,
  onCommit,
  multiline = false,
  maxLength = 200,
  placeholder = "",
  onDirty,
  autoFocus = false,
  className = "",
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  onDirty?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value),
    composing = useRef(false),
    discard = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const shared = {
    value: draft,
    "aria-label": label,
    maxLength,
    placeholder,
    autoFocus,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setDraft(e.target.value);
      onDirty?.();
    },
    onBlur: () => {
      onCommit(discard.current ? value : draft);
      discard.current = false;
    },
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (composing.current || e.nativeEvent.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        discard.current = true;
        setDraft(value);
        e.currentTarget.blur();
      } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
  };
  return (
    <label className={"field " + className}>
      <span>{label}</span>
      {multiline ? <textarea {...shared} rows={6} /> : <input {...shared} />}
    </label>
  );
}
type Panel = "shape" | "color" | "memo" | "label" | "more";
// Actions for the selection sit in a bar just above it; anything with more
// than a click behind it opens in a small panel under the bar.
export function SelectionBar({
  doc,
  node,
  edge,
  count,
  selection,
  onColors,
  onPatch,
  onEdge,
  onDelete,
  onDuplicate,
  onGroup,
  onAttach,
  onFitGroup,
  onSelect,
  onDirty,
}: {
  doc: CanvasDocument;
  node?: CanvasNode;
  edge?: CanvasEdge;
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
  onDirty: () => void;
}) {
  const [open, setOpen] = useState<Panel | null>(null);
  const key = selection.join(",");
  useEffect(() => setOpen(null), [key]);
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
  const toggle = (panel: Panel) => setOpen(open === panel ? null : panel);
  const panelButton = (panel: Panel, label: string, content: ReactNode) => (
    <button
      className={"bar-button" + (open === panel ? " open" : "")}
      aria-label={label}
      title={label}
      aria-expanded={open === panel}
      onClick={() => toggle(panel)}
    >
      {content}
    </button>
  );
  const colorButton = panelButton(
    "color",
    "色",
    <span
      className="bar-swatch"
      style={
        {
          "--swatch-fill":
            (fill.value !== "transparent" && fill.value) ||
            (nodes.length ? "var(--surface)" : "transparent"),
          "--swatch-stroke": stroke.value || "var(--shape-line)",
        } as CSSProperties
      }
    />,
  );
  const hasGroups = doc.nodes.some((n) => n.kind === "group");
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="選択した要素の操作"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
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
            <button
              className="bar-button"
              aria-label="破線にする"
              title="破線にする"
              aria-pressed={edge.dashed}
              onClick={() => onEdge(edge.id, { dashed: !edge.dashed })}
            >
              <Icon name="dashed" />
            </button>
            <button
              className="bar-button"
              aria-label="向きを逆にする"
              title="向きを逆にする"
              onClick={() => onEdge(edge.id, { from: edge.to, to: edge.from })}
            >
              <Icon name="swap" />
            </button>
          </>
        )}
        {node &&
          node.kind !== "group" &&
          panelButton(
            "memo",
            "メモを開く",
            <>
              <Icon name="note" />
              <span>メモ</span>
            </>,
          )}
        {count > 1 && (
          <button
            className="bar-button"
            aria-label="囲む"
            title="囲む (⌘ G)"
            onClick={onGroup}
          >
            <Icon name="group" />
          </button>
        )}
        {node?.kind === "group" && (
          <button
            className="bar-button"
            aria-label="内容に合わせる"
            title="内容に合わせる"
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
            title="複製 (⌘ D)"
            onClick={onDuplicate}
          >
            <Icon name="duplicate" />
          </button>
        )}
        <button
          className="bar-button danger"
          aria-label={node?.kind === "group" ? "囲みを解除" : "削除"}
          title={node?.kind === "group" ? "囲みを解除" : "削除 (Delete)"}
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
        {node && panelButton("more", "その他", <Icon name="more" />)}
      </div>
      {open && (
        <div className="bar-panel" key={open}>
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
              <TextField
                label="メモ"
                value={parent ? parent.body : node.body}
                onCommit={(body) => onPatch(parent?.id || node.id, { body })}
                onDirty={onDirty}
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
                    ? "図に置いたメモを選択"
                    : "メモを図に置く"}
                </button>
              )}
            </>
          )}
          {open === "label" && edge && (
            <TextField
              label="線のラベル"
              value={edge.label}
              onCommit={(label) => onEdge(edge.id, { label })}
              onDirty={onDirty}
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
              {node.kind === "group" && (
                <TextField
                  label="見出し"
                  value={node.title}
                  onCommit={(title) => patch({ title })}
                  onDirty={onDirty}
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
              <div className="size-fields">
                {(["w", "h"] as const).map((key, i) => (
                  <label key={key}>
                    {i ? "高さ" : "幅"}
                    <input
                      type="number"
                      aria-label={i ? "高さ" : "幅"}
                      min={i ? 50 : 160}
                      max={i ? 20000 : 4000}
                      step="10"
                      value={Math.round(node[key])}
                      onChange={(e) => {
                        const value = e.target.valueAsNumber;
                        if (Number.isFinite(value))
                          patch({
                            [key]: Math.max(
                              i ? 50 : 160,
                              Math.min(i ? 20000 : 4000, value),
                            ),
                          });
                      }}
                    />
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function InlineEditor({
  node,
  doc,
  onFinish,
  onCancel,
  isNew = false,
  onDirty,
  zoom,
  maxHeight,
}: {
  node: CanvasNode;
  doc: CanvasDocument;
  onFinish: (patch: Partial<CanvasNode>) => void;
  onCancel: () => void;
  isNew?: boolean;
  onDirty: () => void;
  zoom: number;
  maxHeight: number;
}) {
  const content = noteContent(node, doc),
    done = useRef(false),
    composing = useRef(false);
  function finish(form: HTMLFormElement) {
    if (done.current) return;
    done.current = true;
    const data = new FormData(form);
    onFinish(
      node.kind === "note"
        ? {
            title: String(data.get("title") || ""),
            body: String(data.get("body") || ""),
          }
        : {
            title: String(data.get("title") || ""),
            description: String(data.get("description") || ""),
          },
    );
  }
  return (
    <form
      className="inline-editor"
      style={{
        width: Math.max(240, Math.min(320, node.w)),
        maxHeight,
        transform: `scale(${1 / zoom})`,
      }}
      aria-label="図の上で編集"
      onSubmit={(e) => {
        e.preventDefault();
        finish(e.currentTarget);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={onDirty}
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
        if (composing.current || e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish(e.currentTarget);
        }
      }}
    >
      {!node.attachedTo && (
        <label>
          <span>{node.kind === "box" ? "名前" : "見出し（任意）"}</span>
          <input
            aria-label="見出しを直接編集"
            name="title"
            defaultValue={node.title}
            maxLength={200}
            autoFocus={node.kind !== "note"}
          />
        </label>
      )}
      {node.kind === "note" ? (
        <label>
          <span>メモ</span>
          <textarea
            aria-label="メモを直接編集"
            name="body"
            defaultValue={content.body}
            maxLength={MAX_TEXT}
            autoFocus
            rows={Math.max(
              4,
              Math.min(15, content.body.split("\n").length + 1),
            )}
          />
        </label>
      ) : node.kind === "box" ? (
        <label>
          <span>説明（任意）</span>
          <textarea
            aria-label="説明を直接編集"
            name="description"
            defaultValue={node.description}
            maxLength={500}
            rows={2}
          />
        </label>
      ) : null}
      <button type="submit">
        {isNew ? "追加" : "完了"} <span>⌘ Enter</span>
      </button>
    </form>
  );
}
