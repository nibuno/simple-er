import { KeyList, DefinitionEditor } from "./ConstraintsEditor.tsx";
import type { DefinitionSelection } from "./ConstraintsEditor.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  Column,
  Diagram,
  Table,
  KeyDefinition,
  ForeignKey,
} from "./types.ts";
import {
  referenceImpacts,
  editTable,
  removeTable,
  inferConnections,
  makeEdge,
  uid,
} from "./model.ts";
import { messageOf, overlaps } from "./utils.ts";
import { tableDDL } from "./ddl.ts";
import { Icon } from "./icons.tsx";
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
      if (
        (previous instanceof HTMLElement || previous instanceof SVGElement) &&
        previous.isConnected
      ) {
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
      } else {
        (
          (document.querySelector(
            ".migration-notice summary",
          ) as HTMLElement | null) ?? document.getElementById("fit")
        )?.focus();
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
  const [custom, setCustom] = useState(!TYPES.includes(column.type)),
    lastCustom = useRef(custom ? column.type : "");
  return (
    <div className="column-type-control">
      <select
        aria-label={`カラム${index + 1}の型`}
        value={custom ? "__custom__" : column.type}
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
          value={column.type}
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
  showConstraints = false,
  initialForeignKey,
  state,
  onClose,
  onApply,
}: {
  initial: Table;
  showConstraints?: boolean;
  initialForeignKey?: string;
  state: Diagram;
  onClose: () => void;
  onApply: (next: Diagram, message?: string, fit?: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial)),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<DefinitionSelection | null>(() => {
    const fk =
      initial.foreignKeys?.find((f) => f.id === initialForeignKey) ??
      (showConstraints ? initial.foreignKeys?.[0] : undefined);
    return fk
      ? { kind: "foreign", id: fk.id, before: structuredClone(fk) }
      : null;
  });
  const impacts = referenceImpacts(state, draft);
  const removedForeignKeys = (initial.foreignKeys ?? []).filter(
    (f) => !draft.foreignKeys?.some((next) => next.id === f.id),
  );
  const incomingCount = state.tables
    .filter((t) => t.id !== draft.id)
    .flatMap((t) => t.foreignKeys ?? [])
    .filter((f) => f.target?.tableId === draft.id).length;
  const body = useRef<HTMLDivElement>(null);
  const definitionPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    definitionPanel.current?.scrollIntoView?.({ block: "nearest" });
    definitionPanel.current
      ?.querySelector<HTMLSelectElement>("select")
      ?.focus({ preventScroll: true });
  }, [editing?.id]);
  function selectDefinition(kind: "key" | "foreign", id: string) {
    if (editing?.id === id) return;
    const before =
      kind === "key"
        ? draft.keys?.find((k) => k.id === id)
        : draft.foreignKeys?.find((f) => f.id === id);
    if (kind === "key")
      setEditing({
        kind,
        id,
        before: before as KeyDefinition,
      });
    else
      setEditing({
        kind,
        id,
        before: before as ForeignKey,
      });
  }
  function cancelDefinition() {
    if (!editing) return;
    setDraft((d) =>
      editing.kind === "key"
        ? {
            ...d,
            keys: d.keys?.flatMap((k) =>
              k.id !== editing.id
                ? [k]
                : editing.before
                  ? [editing.before]
                  : [],
            ),
          }
        : {
            ...d,
            foreignKeys: d.foreignKeys?.flatMap((f) =>
              f.id !== editing.id
                ? [f]
                : editing.before
                  ? [editing.before]
                  : [],
            ),
          },
    );
    setEditing(null);
  }
  function toggleKey(
    columnId: string,
    kind: "primary" | "unique",
    checked: boolean,
  ) {
    setDraft((d) => {
      let keys = [...(d.keys ?? [])];
      if (kind === "primary") {
        const pk = keys.find((k) => k.kind === "primary");
        const columnIds = checked
          ? [...(pk?.columnIds ?? []), columnId]
          : (pk?.columnIds ?? []).filter((id) => id !== columnId);
        keys = pk
          ? keys.flatMap((k) =>
              k.id !== pk.id
                ? [k]
                : columnIds.length
                  ? [{ ...k, columnIds }]
                  : [],
            )
          : [...keys, { id: uid(), name: "", kind, columnIds }];
      } else if (checked)
        keys.push({ id: uid(), name: "", kind, columnIds: [columnId] });
      else
        keys = keys.filter(
          (k) =>
            !(
              k.kind === "unique" &&
              k.columnIds.length === 1 &&
              k.columnIds[0] === columnId
            ),
        );
      return { ...d, keys };
    });
  }
  function addReference(columnId: string) {
    const id = uid();
    setDraft((d) => ({
      ...d,
      foreignKeys: [
        ...(d.foreignKeys ?? []),
        { id, name: "", columnIds: [columnId] },
      ],
    }));
    setEditing({ kind: "foreign", id });
  }
  function referenceLabel(f: ForeignKey, columnId: string) {
    if (!f.target) return "未設定";
    const target =
      f.target.tableId === draft.id
        ? draft
        : state.tables.find((t) => t.id === f.target!.tableId);
    const name =
      target?.columns.find(
        (c) => c.id === f.target!.columnIds[f.columnIds.indexOf(columnId)],
      )?.name ?? "未設定";
    return `${target?.name ?? target?.id ?? "未設定"}.${name}`;
  }
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
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
    input.scrollIntoView?.({ block: "nearest" });
    input.focus({ preventScroll: true });
    input.select();
  }, [draft.columns]);
  function column(
    index: number,
    patch: Partial<Pick<Column, "name" | "type" | "logicalName">>,
  ) {
    setDraft((d) => ({
      ...d,
      columns: d.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  }
  function move(id: string, to: number) {
    setDraft((d) => {
      const columns = [...d.columns],
        from = columns.findIndex((c) => c.id === id);
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
            const changes = [
              impacts.length
                ? `外部キー${impacts.length}件を参照先未設定にしました。「要確認」から設定できます。`
                : "",
              removedForeignKeys.length
                ? `外部キー${removedForeignKeys.length}件を削除しました。`
                : "",
            ]
              .filter(Boolean)
              .join(" ");
            onApply(
              next,
              changes ? changes + "「元に戻す」で復元できます。" : "",
              creating,
            );
            onClose();
          } catch (e) {
            setError(messageOf(e));
          }
        }}
      >
        <div className="dialog-heading">
          <Icon name="table" />
          <h2 id="editor-heading">テーブルを{creating ? "追加" : "編集"}</h2>
          {!creating && (
            <span className="dialog-subject mono">{initial.name}</span>
          )}
          <span className="spacer" />
          <kbd className="kbd">Esc</kbd>
          <button
            type="button"
            className="icon-button"
            aria-label="編集を閉じる"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="editor-layout">
          <div className="editor-main">
            <div className="table-names">
              <label className="field">
                物理名
                <input
                  autoFocus
                  required
                  maxLength={80}
                  autoComplete="off"
                  placeholder="例: users"
                  value={draft.name ?? draft.id}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="field">
                論理名（任意）
                <input
                  maxLength={80}
                  autoComplete="off"
                  placeholder="例: ユーザー"
                  value={draft.logicalName ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, logicalName: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="table-editor-body" ref={body}>
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
                <span>主キー</span>
                <span>一意</span>
                <span>参照先</span>
                <span />
              </div>
              <div id="column-editor" ref={list}>
                {draft.columns.map((c, i) => {
                  const otherIndex = draft.columns
                    .filter((x) => x.id !== dragging)
                    .findIndex((x) => x.id === c.id);
                  const marker =
                    dragging !== c.id &&
                    drop !== null &&
                    (otherIndex === drop
                      ? " drop-before"
                      : drop === draft.columns.length - 1 &&
                          otherIndex === drop - 1
                        ? " drop-after"
                        : "");
                  return (
                    <div
                      key={c.id}
                      data-column={c.id}
                      className={`column-edit-row${dragging === c.id ? " reordering" : ""}${marker || ""}`}
                    >
                      <button
                        type="button"
                        className="reorder-handle"
                        aria-label={`カラム${i + 1}を並べ替え。ドラッグ、または上下矢印キーで移動`}
                        title="ドラッグして並べ替え"
                        onKeyDown={(e) => {
                          if (!["ArrowUp", "ArrowDown"].includes(e.key)) return;
                          e.preventDefault();
                          move(c.id, i + (e.key === "ArrowUp" ? -1 : 1));
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          reorder.current = {
                            id: c.id,
                            target: i,
                            pointerY: e.clientY,
                          };
                          setDragging(c.id);
                          e.currentTarget.setPointerCapture(e.pointerId);
                          frame.current = requestAnimationFrame(paint);
                        }}
                        onPointerMove={(e) => {
                          if (reorder.current)
                            reorder.current.pointerY = e.clientY;
                        }}
                        onPointerUp={() => end()}
                        onPointerCancel={() => end(true)}
                        onLostPointerCapture={() => end(true)}
                      >
                        <svg
                          viewBox="0 0 16 16"
                          width="12"
                          height="12"
                          aria-hidden="true"
                          focusable="false"
                          fill="currentColor"
                        >
                          <circle cx="5.5" cy="3.5" r="1.3" />
                          <circle cx="10.5" cy="3.5" r="1.3" />
                          <circle cx="5.5" cy="8" r="1.3" />
                          <circle cx="10.5" cy="8" r="1.3" />
                          <circle cx="5.5" cy="12.5" r="1.3" />
                          <circle cx="10.5" cy="12.5" r="1.3" />
                        </svg>
                      </button>
                      <div className="column-names">
                        <input
                          aria-label={`カラム${i + 1}の物理名`}
                          placeholder="例: user_id"
                          required
                          maxLength={80}
                          value={c.name}
                          onChange={(e) => column(i, { name: e.target.value })}
                        />
                        <input
                          aria-label={`カラム${i + 1}の論理名`}
                          placeholder="論理名"
                          maxLength={80}
                          value={c.logicalName ?? ""}
                          onChange={(e) =>
                            column(i, { logicalName: e.target.value })
                          }
                        />
                      </div>
                      <TypeControl
                        column={c}
                        index={i}
                        onChange={(value) => column(i, { type: value })}
                      />
                      <label className="column-check primary-check">
                        <span aria-hidden="true">PK</span>
                        <input
                          type="checkbox"
                          aria-label={`${c.name}を主キーに含める`}
                          disabled={editing?.kind === "key"}
                          checked={
                            draft.keys?.some(
                              (k) =>
                                k.kind === "primary" &&
                                k.columnIds.includes(c.id),
                            ) ?? false
                          }
                          onChange={(e) =>
                            toggleKey(c.id, "primary", e.target.checked)
                          }
                        />
                      </label>
                      <label className="column-check unique-check">
                        <span aria-hidden="true">UQ</span>
                        <input
                          type="checkbox"
                          aria-label={`${c.name}の単独一意制約`}
                          disabled={editing?.kind === "key"}
                          checked={
                            draft.keys?.some(
                              (k) =>
                                k.kind === "unique" &&
                                k.columnIds.length === 1 &&
                                k.columnIds[0] === c.id,
                            ) ?? false
                          }
                          onChange={(e) =>
                            toggleKey(c.id, "unique", e.target.checked)
                          }
                        />
                      </label>
                      <div className="column-references">
                        {draft.foreignKeys
                          ?.filter((f) => f.columnIds.includes(c.id))
                          .map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className="reference-link"
                              disabled={!!editing && editing.id !== f.id}
                              aria-label={`${c.name}の参照先 ${referenceLabel(f, c.id)}を編集`}
                              onClick={() => selectDefinition("foreign", f.id)}
                            >
                              → {referenceLabel(f, c.id)}
                              {f.columnIds.length > 1 && <small>複合</small>}
                            </button>
                          ))}
                        <button
                          type="button"
                          className="reference-link add-reference"
                          disabled={!!editing}
                          aria-label={`${c.name}に参照先を追加`}
                          onClick={() => addReference(c.id)}
                        >
                          ＋ 参照先
                        </button>
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="delete-column"
                          title="カラムを削除"
                          aria-label={`カラム${i + 1}を削除`}
                          disabled={draft.columns.length === 1 || !!editing}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              keys: draft.keys?.filter(
                                (k) => !k.columnIds.includes(c.id),
                              ),
                              foreignKeys: draft.foreignKeys?.filter(
                                (f) => !f.columnIds.includes(c.id),
                              ),
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
                  while (draft.columns.some((c) => c.name === `column_${i}`))
                    i++;
                  const id = uid();
                  addedColumn.current = id;
                  setDraft({
                    ...draft,
                    columns: [
                      ...draft.columns,
                      {
                        name: `column_${i}`,
                        type: "text",
                        key: "",
                        id,
                        logicalName: "",
                      },
                    ],
                  });
                }}
              >
                カラムを追加
              </button>
              <KeyList
                table={draft}
                onEdit={(id) => selectDefinition("key", id)}
                onAdd={() => {
                  const id = uid();
                  setDraft((d) => ({
                    ...d,
                    keys: [
                      ...(d.keys ?? []),
                      { id, name: "", kind: "index", columnIds: [] },
                    ],
                  }));
                  setEditing({ kind: "key", id });
                }}
                disabled={!!editing}
              />
              {editing && (
                <div ref={definitionPanel}>
                  <DefinitionEditor
                    draft={draft}
                    state={state}
                    selection={editing}
                    onChange={setDraft}
                    onDone={() => setEditing(null)}
                    onCancel={cancelDefinition}
                    onDelete={() => {
                      setDraft((d) =>
                        editing.kind === "key"
                          ? {
                              ...d,
                              keys: d.keys?.filter((k) => k.id !== editing.id),
                            }
                          : {
                              ...d,
                              foreignKeys: d.foreignKeys?.filter(
                                (f) => f.id !== editing.id,
                              ),
                            },
                      );
                      setEditing(null);
                    }}
                  />
                </div>
              )}
              <details className="ddl-section">
                <summary>
                  DDL プレビュー <span>PostgreSQL</span>
                </summary>
                <pre className="ddl">{tableDDL(draft, state)}</pre>
              </details>
            </div>
          </div>
        </div>
        {impacts.length > 0 && (
          <details className="reference-impact">
            <summary>
              変更を反映すると、外部キー{impacts.length}
              件が参照先未設定になります
            </summary>
            <ul>
              {impacts.map(({ table, foreignKey: fk }) => (
                <li key={fk.id}>
                  {table.name || table.id}.
                  {fk.columnIds
                    .map((id) => table.columns.find((c) => c.id === id)?.name)
                    .join(", ")}
                </li>
              ))}
            </ul>
            <p>反映後、図の「要確認」から参照先を設定できます。</p>
          </details>
        )}
        {removedForeignKeys.length > 0 && (
          <p className="reference-impact">
            このテーブルの外部キー{removedForeignKeys.length}件を削除します。
          </p>
        )}
        {incomingCount > 0 && (
          <p className="reference-impact">
            テーブルを削除すると、他テーブルの外部キー{incomingCount}
            件が参照先未設定になります。
          </p>
        )}
        <p className="error" role="alert">
          {error}
        </p>
        <div className="dialog-actions">
          {!creating && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                onApply(
                  removeTable(state, draft.id).next,
                  `${draft.name || draft.id}を削除しました。${incomingCount ? `外部キー${incomingCount}件は参照先未設定として「要確認」に残しています。` : ""}「元に戻す」で復元できます。`,
                );
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
                column.key = column.key.includes("PK") ? "PK,FK" : "FK";
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
