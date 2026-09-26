import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Column, Diagram, Key, Table } from "./types.ts";
import { editTable, inferConnections, makeEdge, uid } from "./model.ts";
import { messageOf, overlaps } from "./utils.ts";
const TYPES = [
  "uuid",
  "integer",
  "bigint",
  "text",
  "varchar(255)",
  "boolean",
  "timestamp",
  "date",
  "decimal",
  "json",
];
function Modal({
  id,
  onClose,
  children,
}: {
  id: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const keyboard = useRef(false);
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement;
    keyboard.current = previous?.matches(":focus-visible") ?? false;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement || previous instanceof SVGElement) {
        if (!keyboard.current) {
          previous.classList.add("pointer-restored-focus");
          const clear = () => {
            previous.classList.remove("pointer-restored-focus");
            previous.removeEventListener("blur", clear);
            previous.removeEventListener("keydown", clear);
          };
          previous.addEventListener("blur", clear);
          previous.addEventListener("keydown", clear);
        }
        previous.focus({ preventScroll: true });
      }
    };
  }, []);
  function outside(event: React.PointerEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    );
  }
  return (
    <dialog
      ref={ref}
      id={id}
      onKeyDownCapture={() => {
        keyboard.current = true;
      }}
      onPointerDownCapture={() => {
        keyboard.current = false;
      }}
      onPointerDown={(e) => {
        backdropPress.current = e.button === 0 && outside(e);
      }}
      onPointerUp={(e) => {
        const close = backdropPress.current && outside(e);
        backdropPress.current = false;
        if (close) onClose();
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      aria-labelledby={
        id === "table-editor" ? "editor-heading" : "infer-heading"
      }
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
function TypeControl({
  column,
  index,
  onChange,
}: {
  column: Column;
  index: number;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(!TYPES.includes(column[1])),
    lastCustom = useRef(custom ? column[1] : "");
  return (
    <div className="column-type-control">
      <select
        aria-label={`カラム${index + 1}の型`}
        value={custom ? "__custom__" : column[1]}
        onChange={(e) => {
          const isCustom = e.target.value === "__custom__";
          setCustom(isCustom);
          onChange(isCustom ? lastCustom.current : e.target.value);
        }}
      >
        {TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
        <option value="__custom__">その他…</option>
      </select>
      {custom && (
        <input
          autoFocus
          required
          maxLength={40}
          aria-label={`カラム${index + 1}の独自の型`}
          placeholder="例: decimal(10,2)"
          value={column[1]}
          onChange={(e) => {
            lastCustom.current = e.target.value;
            onChange(e.target.value);
          }}
        />
      )}
    </div>
  );
}
export function TableEditor({
  initial,
  state,
  onClose,
  onApply,
}: {
  initial: Table;
  state: Diagram;
  onClose: () => void;
  onApply: (next: Diagram, message?: string, fit?: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial)),
    [error, setError] = useState("");
  const addedColumn = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null),
    frame = useRef(0);
  const [dragging, setDragging] = useState<string | null>(null),
    [drop, setDrop] = useState<number | null>(null);
  const reorder = useRef<{
    id: string;
    target: number;
    pointerY: number;
  } | null>(null);
  const creating = !state.tables.some((t) => t.id === draft.id);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useLayoutEffect(() => {
    const id = addedColumn.current;
    if (!id || !list.current) return;
    const input = list.current.querySelector<HTMLInputElement>(
      `[data-column="${CSS.escape(id)}"] input`,
    );
    if (!input) return;
    addedColumn.current = null;
    // Scroll only the list, keeping the dialog and action buttons in place.
    list.current.scrollTop = list.current.scrollHeight;
    input.focus({ preventScroll: true });
    input.select();
  }, [draft.columns]);
  function column(
    index: number,
    patch: Partial<Record<0 | 1 | 2 | 4, string>>,
  ) {
    setDraft((d) => ({
      ...d,
      columns: d.columns.map((c, i) =>
        i === index ? (Object.assign([...c], patch) as Column) : c,
      ),
    }));
  }
  function move(id: string, to: number) {
    setDraft((d) => {
      const columns = [...d.columns],
        from = columns.findIndex((c) => c[3] === id);
      if (from < 0 || to < 0 || to >= columns.length) return d;
      const [c] = columns.splice(from, 1);
      columns.splice(to, 0, c);
      return { ...d, columns };
    });
    requestAnimationFrame(() => {
      list.current
        ?.querySelector<HTMLButtonElement>(
          `[data-column="${CSS.escape(id)}"] .reorder-handle`,
        )
        ?.focus({ preventScroll: true });
    });
  }
  function paint() {
    const d = reorder.current,
      el = list.current;
    if (!d || !el) return;
    const bounds = el.getBoundingClientRect();
    if (d.pointerY < bounds.top + 30) el.scrollTop -= 7;
    else if (d.pointerY > bounds.bottom - 30) el.scrollTop += 7;
    const others = [...el.children].filter(
      (e) => e.getAttribute("data-column") !== d.id,
    );
    d.target = others.filter((e) => {
      const r = e.getBoundingClientRect();
      return d.pointerY > r.top + r.height / 2;
    }).length;
    setDrop(d.target);
    frame.current = requestAnimationFrame(paint);
  }
  function end(cancel = false) {
    const d = reorder.current;
    if (!d) return;
    cancelAnimationFrame(frame.current);
    reorder.current = null;
    setDragging(null);
    setDrop(null);
    if (!cancel) move(d.id, d.target);
  }
  return (
    <Modal id="table-editor" onClose={onClose}>
      <form
        id="table-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const next = editTable(state, draft),
              table = next.tables.find((t) => t.id === draft.id)!;
            if (overlaps(table, next.tables))
              throw new Error(
                "テーブルの幅または高さが他のテーブルと重なります。先に配置を広げてから変更してください。",
              );
            const removed = state.edges.length - next.edges.length;
            onApply(
              next,
              removed
                ? `カラムの削除に伴い、接続${removed}本も削除しました。「元に戻す」で復元できます。`
                : "",
              creating,
            );
            onClose();
          } catch (e) {
            setError(messageOf(e));
          }
        }}
      >
        <div className="dialog-heading">
          <h2 id="editor-heading">テーブルを{creating ? "追加" : "編集"}</h2>
          <button type="button" aria-label="編集を閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="table-names">
          <label className="field">
            物理名
            <input
              autoFocus
              required
              maxLength={80}
              autoComplete="off"
              placeholder="users"
              value={draft.name ?? draft.id}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="field">
            論理名（任意）
            <input
              maxLength={80}
              autoComplete="off"
              placeholder="ユーザー"
              value={draft.logicalName ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, logicalName: e.target.value })
              }
            />
          </label>
        </div>
        <div className="column-heading">
          <h3>
            カラム
            <span id="column-count" aria-live="polite">
              （{draft.columns.length}）
            </span>
          </h3>
        </div>
        <div className="column-labels" aria-hidden="true">
          <span />
          <span>物理名</span>
          <span>
            論理名 <small>（任意）</small>
          </span>
          <span>型</span>
          <span>キー</span>
          <span />
        </div>
        <div id="column-editor" ref={list}>
          {draft.columns.map((c, i) => {
            const otherIndex = draft.columns
              .filter((x) => x[3] !== dragging)
              .findIndex((x) => x[3] === c[3]);
            const marker =
              dragging !== c[3] &&
              drop !== null &&
              (otherIndex === drop
                ? " drop-before"
                : drop === draft.columns.length - 1 && otherIndex === drop - 1
                  ? " drop-after"
                  : "");
            return (
              <div
                key={c[3]}
                data-column={c[3]}
                className={`column-edit-row${dragging === c[3] ? " reordering" : ""}${marker || ""}`}
              >
                <button
                  type="button"
                  className="reorder-handle"
                  aria-label={`カラム${i + 1}を並べ替え。ドラッグ、または上下矢印キーで移動`}
                  title="ドラッグして並べ替え"
                  onKeyDown={(e) => {
                    if (!["ArrowUp", "ArrowDown"].includes(e.key)) return;
                    e.preventDefault();
                    move(c[3]!, i + (e.key === "ArrowUp" ? -1 : 1));
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    reorder.current = {
                      id: c[3]!,
                      target: i,
                      pointerY: e.clientY,
                    };
                    setDragging(c[3]!);
                    e.currentTarget.setPointerCapture(e.pointerId);
                    frame.current = requestAnimationFrame(paint);
                  }}
                  onPointerMove={(e) => {
                    if (reorder.current) reorder.current.pointerY = e.clientY;
                  }}
                  onPointerUp={() => end()}
                  onPointerCancel={() => end(true)}
                  onLostPointerCapture={() => end(true)}
                >
                  ⠿
                </button>
                <div className="column-names">
                  <input
                    aria-label={`カラム${i + 1}の物理名`}
                    placeholder="物理名（user_id）"
                    required
                    maxLength={80}
                    value={c[0]}
                    onChange={(e) => column(i, { 0: e.target.value })}
                  />
                  <input
                    aria-label={`カラム${i + 1}の論理名`}
                    placeholder="論理名（ユーザーID）"
                    maxLength={80}
                    value={c[4] ?? ""}
                    onChange={(e) => column(i, { 4: e.target.value })}
                  />
                </div>
                <TypeControl
                  column={c}
                  index={i}
                  onChange={(value) => column(i, { 1: value })}
                />
                <select
                  aria-label={`カラム${i + 1}のキー`}
                  value={c[2]}
                  onChange={(e) => column(i, { 2: e.target.value as Key })}
                >
                  {[
                    ["", "—"],
                    ["PK", "主キー"],
                    ["FK", "外部キー"],
                    ["PK,FK", "主キー・外部キー"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="row-actions">
                  <button
                    type="button"
                    className="delete-column"
                    title="カラムを削除"
                    aria-label={`カラム${i + 1}を削除`}
                    disabled={draft.columns.length === 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        columns: draft.columns.filter(
                          (_, index) => index !== i,
                        ),
                      })
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                      width="16"
                      height="16"
                    >
                      <path
                        d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="add-column"
          disabled={draft.columns.length >= 60}
          onClick={() => {
            let i = 1;
            while (draft.columns.some((c) => c[0] === `column_${i}`)) i++;
            const id = uid();
            addedColumn.current = id;
            setDraft({
              ...draft,
              columns: [...draft.columns, [`column_${i}`, "text", "", id, ""]],
            });
          }}
        >
          カラムを追加
        </button>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="dialog-actions">
          {!creating && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                onApply({
                  tables: state.tables.filter((t) => t.id !== draft.id),
                  edges: state.edges.filter(
                    (e) => e.from.table !== draft.id && e.to.table !== draft.id,
                  ),
                });
                onClose();
              }}
            >
              テーブルを削除
            </button>
          )}
          <span />
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="primary">
            変更を反映
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function InferDialog({
  state,
  onClose,
  onApply,
}: {
  state: Diagram;
  onClose: () => void;
  onApply: (next: Diagram) => void;
}) {
  const [result] = useState(() => inferConnections(state)),
    [checked, setChecked] = useState(
      () => new Set(result.candidates.map((_, i) => i)),
    ),
    [error, setError] = useState("");
  return (
    <Modal id="infer-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <h2 id="infer-heading">名前から接続を見つける</h2>
        <button aria-label="候補を閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="explanation">
        user_id → users.id
        のような名前と型から推測します。接続する候補を選んでください。
      </p>
      <div>
        {result.candidates.length ? (
          result.candidates.map((c, i) => (
            <label className="candidate" key={i}>
              <input
                type="checkbox"
                checked={checked.has(i)}
                onChange={(e) => {
                  const next = new Set(checked);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setChecked(next);
                }}
              />
              <span>{c.label}</span>
            </label>
          ))
        ) : (
          <p>
            新しく接続できる候補はありません。すでに接続済みのカラムは除いています。
          </p>
        )}
      </div>
      {!!result.skipped.length && (
        <details>
          <summary>接続先を特定できなかったカラム</summary>
          <ul>
            {result.skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <div className="dialog-actions">
        <span />
        <button onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          disabled={!checked.size}
          onClick={() => {
            try {
              const next = structuredClone(state);
              for (const i of checked) {
                const candidate = result.candidates[i],
                  column = next.tables.find((t) => t.id === candidate.to.table)!
                    .columns[candidate.to.row];
                column[2] = column[2].includes("PK") ? "PK,FK" : "FK";
                next.edges.push(makeEdge(next, candidate.from, candidate.to));
              }
              onApply(next);
              onClose();
            } catch (e) {
              setError(messageOf(e));
            }
          }}
        >
          選択した候補を接続
        </button>
      </div>
    </Modal>
  );
}
