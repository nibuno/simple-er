import { useEffect, useRef, useState } from "react";
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
export function Inspector({
  doc,
  node,
  edge,
  count,
  selection,
  onColors,
  onPatch,
  onEdge,
  onClose,
  onDelete,
  onDuplicate,
  onAttach,
  onFitGroup,
  onSelect,
  onEdit,
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
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAttach: (id: string) => void;
  onFitGroup: (id: string) => void;
  onSelect: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onDirty: () => void;
}) {
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
  // A figure's panel leads with its shape and text; colors come next.
  const colors = (
    <>
      {!!nodes.length && (
        <ColorPicker
          label="塗り"
          kind="fill"
          {...sharedColor(nodes, "fillColor")}
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
        {...sharedColor(elements, "strokeColor")}
        defaultColor={
          nodes.length ? DEFAULT_COLORS.stroke : DEFAULT_COLORS.line
        }
        onChange={(strokeColor) => onColors({ strokeColor })}
      />
    </>
  );
  return (
    <aside className="inspector" aria-label="選択した要素の編集">
      <div className="inspector-heading">
        <strong>
          {count > 1
            ? count + "個を選択"
            : edge
              ? "接続線"
              : node?.kind === "group"
                ? "囲み"
                : node?.kind === "note"
                  ? "メモ"
                  : "図形とメモ"}
        </strong>
        <button
          className="icon-button"
          aria-label="編集パネルを閉じる"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div
        className="inspector-content"
        key={node?.id || edge?.id || "multiple"}
      >
        {!node && colors}
        {count > 1 && (
          <p className="muted">
            一緒に移動・複製できます。「囲む」で、まとまりに名前を付けられます。
          </p>
        )}
        {node && (
          <>
            {parent ? (
              <div className="attached-label">
                <button
                  className="text-button"
                  onClick={() => onSelect([parent.id])}
                >
                  {parent.title || shapeLabels[parent.shape]}
                </button>{" "}
                のメモ
              </div>
            ) : node.kind === "box" ? (
              <button
                className="secondary full"
                onClick={() => onEdit(node.id)}
              >
                名前と説明を編集
              </button>
            ) : (
              <TextField
                label="見出し"
                value={node.title}
                onCommit={(title) => patch({ title })}
                onDirty={onDirty}
                placeholder={node.kind === "note" ? "任意" : ""}
              />
            )}
            {node.kind === "box" && (
              <div className="field">
                <span id="shape-choice">図形</span>
                <div
                  className="shape-choice"
                  role="radiogroup"
                  aria-labelledby="shape-choice"
                >
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
              </div>
            )}
            {colors}
            {node.kind !== "group" && (
              <TextField
                label="メモ"
                value={parent ? parent.body : node.body}
                onCommit={(body) => onPatch(parent?.id || node.id, { body })}
                onDirty={onDirty}
                multiline
                maxLength={MAX_TEXT}
              />
            )}
            {node.kind === "box" && (
              <button
                className="secondary full"
                onClick={() => onAttach(node.id)}
              >
                <Icon name="note" />
                {doc.nodes.some((n) => n.attachedTo === node.id)
                  ? "図に置いたメモを選択"
                  : "メモを図に置く"}
              </button>
            )}
            {parent && (
              <p className="field-help">
                このメモは図形のメモと同じ内容です。図形を動かすと一緒に移動します。
              </p>
            )}
            {node.kind === "note" && !parent && (
              <button
                className="text-button"
                onClick={() =>
                  patch({
                    kind: "box",
                    title: node.title || node.body.split("\n")[0].slice(0, 80),
                  })
                }
              >
                箱にする
              </button>
            )}
            {node.kind !== "group" &&
              doc.nodes.some((n) => n.kind === "group") && (
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
            {node.kind === "group" && (
              <>
                <p className="field-help">
                  見出しをドラッグすると、中の要素も一緒に動きます。
                </p>
                <button
                  className="secondary"
                  onClick={() => onFitGroup(node.id)}
                >
                  内容に合わせる
                </button>
              </>
            )}
            <details className="size-settings">
              <summary>サイズ</summary>
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
            </details>
          </>
        )}
        {edge && (
          <>
            <div className="edge-endpoints">
              {doc.nodes.find((n) => n.id === edge.from)?.title || "メモ"}
              <Icon name="arrow" />
              {doc.nodes.find((n) => n.id === edge.to)?.title || "メモ"}
            </div>
            <TextField
              label="線のラベル"
              value={edge.label}
              onCommit={(label) => onEdge(edge.id, { label })}
              onDirty={onDirty}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={edge.dashed}
                onChange={(e) => onEdge(edge.id, { dashed: e.target.checked })}
              />
              破線にする
            </label>
            <button
              className="text-button"
              onClick={() => onEdge(edge.id, { from: edge.to, to: edge.from })}
            >
              向きを逆にする
            </button>
          </>
        )}
      </div>
      <div className="inspector-actions">
        {!edge && (
          <button onClick={onDuplicate}>
            <Icon name="duplicate" />
            複製
          </button>
        )}
        <button onClick={onDelete} className="delete-button">
          <Icon name="trash" />
          {node?.kind === "group" ? "囲みを解除" : "削除"}
        </button>
      </div>
    </aside>
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
