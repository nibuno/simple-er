import { watchStorage } from "../shared/storage.ts";
import { messageOf, overlaps } from "./utils.ts";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  Column,
  Diagram,
  DiagramDocument,
  Endpoint,
  Table,
  View,
} from "./types.ts";
import { initialDocument } from "./initial.ts";
import {
  canConnect,
  removeForeignKey,
  editTable,
  decode,
  decodeDocument,
  documentFromDiagram,
  projectDocument,
  encodeDocument,
  makeEdge,
  title,
  uid,
} from "./model.ts";
import { tableWidth } from "./geometry.ts";
import { tidyDiagram } from "./layout.ts";
import { historyReducer } from "./history.ts";
import { DiagramCanvas } from "./DiagramCanvas.tsx";
import { TableEditor, InferDialog } from "./Dialogs.tsx";
import { Inspector, Sidebar } from "./Panels.tsx";
import { Icon, Logo } from "./icons.tsx";

const STORAGE = "er-sketch.local.v1";
function restore() {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved)
      try {
        const diagram = decodeDocument(saved);
        try {
          if (
            JSON.parse(saved).version === 1 &&
            !localStorage.getItem(STORAGE + ".v1-backup")
          )
            localStorage.setItem(STORAGE + ".v1-backup", saved);
        } catch {
          return {
            diagram,
            message:
              "旧データの退避先に保存できませんでした。ファイルに保存してバックアップしてください。",
          };
        }
        return { diagram, message: "" };
      } catch {
        localStorage.setItem(STORAGE + ".recovery", saved);
        return {
          diagram: structuredClone(initialDocument),
          message:
            "保存データを読み込めませんでした。元データを退避し、サンプルを表示しています。",
        };
      }
  } catch {
    return {
      diagram: structuredClone(initialDocument),
      message: "自動保存を利用できません。ファイルに保存してください",
    };
  }
  return { diagram: structuredClone(initialDocument), message: "" };
}
export function App() {
  const [loaded] = useState(restore);
  const [history, dispatch] = useReducer(historyReducer, {
    present: loaded.diagram,
    past: [],
    future: [],
  });
  const state = useMemo(
    () => projectDocument(history.present),
    [history.present],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [focusedTable, setFocusedTable] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<{
    id: string;
    n: number;
  } | null>(null);
  const [adjustingLine, setAdjustingLine] = useState(false);
  const [adjustable, setAdjustable] = useState(false);
  const [pending, setPending] = useState<Endpoint | null>(null);
  const [hint, setHint] = useState(loaded.message);
  const [saveError, setSaveError] = useState("");
  const [storageConflict, setStorageConflict] = useState(false);
  const pausedSave = useRef(false);
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    try {
      lastSaved.current = localStorage.getItem(STORAGE);
    } catch {}
    return watchStorage(
      STORAGE,
      () => lastSaved.current,
      () => {
        pausedSave.current = true;
        setStorageConflict(true);
      },
    );
  }, []);
  const [logical, setLogical] = useState(() => {
    try {
      return localStorage.getItem("er-sketch.name-display") === "logical";
    } catch {
      return false;
    }
  });
  const [draft, setDraft] = useState<Table | null>(null);
  const [editConstraints, setEditConstraints] = useState(false);
  const [editingForeignKey, setEditingForeignKey] = useState<
    string | undefined
  >();
  const [infer, setInfer] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const view = useRef<View>({ x: 0, y: 0, w: 1200, h: 720, zoom: 100 });
  const file = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const displayTable = (t: Table) =>
    logical && t.logicalName ? t.logicalName : title(t);
  const displayColumn = (c: Column) =>
    logical && c.logicalName ? c.logicalName : c.name;
  function save(next: DiagramDocument) {
    if (pausedSave.current) return;
    try {
      const raw = encodeDocument(next);
      // Also detect a write that arrived before its storage event was delivered.
      if (localStorage.getItem(STORAGE) !== lastSaved.current) {
        pausedSave.current = true;
        setStorageConflict(true);
        return;
      }
      localStorage.setItem(STORAGE, raw);
      lastSaved.current = raw;
      setSaveError("");
    } catch {
      setSaveError("自動保存できません。ファイルに保存してください");
    }
  }
  function commit(next: Diagram, before?: Diagram) {
    const valid = documentFromDiagram(next);
    dispatch({
      type: "commit",
      next: valid,
      before: before ? documentFromDiagram(before) : undefined,
    });
    save(valid);
  }
  function clear() {
    setSelected(null);
    setFocusedTable(null);
    setAdjustingLine(false);
    setPending(null);
    setHint("");
  }
  function replace(next: Diagram, message = "", fit = false) {
    commit(next);
    clear();
    setHint(message);
    if (fit) setFitRequest((n) => n + 1);
  }
  function undo() {
    if (!history.past.length) return;
    dispatch({ type: "undo" });
    save(history.past.at(-1)!);
    clear();
    // Keep the inspected table open; it closes itself if the table disappears.
    setFocusedTable(focusedTable);
  }
  function redo() {
    if (!history.future.length) return;
    dispatch({ type: "redo" });
    save(history.future.at(-1)!);
    clear();
    // Keep the inspected table open; it closes itself if the table disappears.
    setFocusedTable(focusedTable);
  }
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (options.current && !options.current.contains(e.target as Node))
        options.current.open = false;
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && options.current?.open) {
        options.current.open = false;
        options.current.querySelector("summary")?.focus();
        return;
      }
      if (
        draft ||
        infer ||
        (e.target instanceof Element &&
          e.target.matches("input,select,textarea"))
      )
        return;
      if (e.key === "Escape") clear();
      if (
        e.key.toLowerCase() === "t" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target instanceof Element && e.target.closest("[contenteditable]"))
      ) {
        e.preventDefault();
        open();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  function open(id?: string, constraints = false, foreignKeyId?: string) {
    setEditingForeignKey(foreignKeyId);
    setEditConstraints(constraints);
    if (id) {
      setDraft(structuredClone(state.tables.find((t) => t.id === id)!));
      return;
    }
    if (state.tables.length >= 40) {
      setHint("テーブルは40個までです。");
      return;
    }
    let index = 1;
    while (state.tables.some((t) => title(t) === `table_${index}`)) index++;
    const table: Table = {
      id: uid(),
      name: `table_${index}`,
      logicalName: "",
      x: Math.round(view.current.x + 80),
      y: Math.round(view.current.y + 100),
      columns: [
        { name: "id", type: "uuid", key: "PK", id: uid(), logicalName: "" },
      ],
      keys: [],
      foreignKeys: [],
    };
    table.keys = [
      {
        id: uid(),
        name: "",
        kind: "primary",
        columnIds: [table.columns[0].id],
      },
    ];
    const origin = { x: table.x, y: table.y };
    let found = false;
    for (let row = 0; row < 50 && !found; row++)
      for (let col = 0; col < 8; col++) {
        table.x = origin.x + col * 330;
        table.y = origin.y + row * 260;
        if (!overlaps(table, state.tables)) {
          found = true;
          break;
        }
      }
    setDraft(table);
  }
  function connect(table: string, row: number) {
    if (!pending) {
      setPending({ table, row });
      setSelected(null);
      setAdjustingLine(false);
      setHint("");
      return;
    }
    if (
      !canConnect(state, pending, { table, row }) &&
      !canConnect(state, { table, row }, pending)
    ) {
      setHint(
        "参照先の主キー・一意制約と参照元カラムを選んでください。複合キーは編集画面で設定できます。",
      );
      return;
    }
    if (
      state.edges.some(
        (e) =>
          (e.from.table === pending.table &&
            e.from.row === pending.row &&
            e.to.table === table &&
            e.to.row === row) ||
          (e.to.table === pending.table &&
            e.to.row === pending.row &&
            e.from.table === table &&
            e.from.row === row),
      )
    ) {
      setPending(null);
      setHint("このカラム同士は接続済みです。");
      return;
    }
    if (state.edges.length >= 200) {
      setHint("接続は200本までです。");
      return;
    }
    const next = structuredClone(state);
    try {
      const edge = makeEdge(next, pending, { table, row });
      commit({ ...next, edges: [...next.edges, edge] });
      clear();
      setSelected(edge.id);
    } catch (error) {
      setPending(null);
      setHint(messageOf(error));
    }
  }
  function download() {
    try {
      const url = URL.createObjectURL(
        new Blob([encodeDocument(history.present)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `er-sketch-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setHint("");
    } catch (error) {
      setHint(`保存できませんでした：${messageOf(error)}`);
    }
  }
  // Keep the optional browser model-context integration on the React state path.
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean };
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    };
    type Context = {
      registerTool: (tool: Tool) => unknown;
      unregisterTool?: (name: string) => void;
    };
    const context =
      (document as Document & { modelContext?: Context }).modelContext ??
      (navigator as Navigator & { modelContext?: Context }).modelContext;
    if (!context?.registerTool) return;
    const register = (tool: Tool) => {
      try {
        Promise.resolve(context.registerTool(tool)).catch(() => {});
      } catch {}
    };
    register({
      name: "inspect_diagram",
      description: "現在のテーブル、配置、接続を取得します。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        if (input && Object.keys(input).length)
          throw new Error("入力は空のオブジェクトにしてください。");
        return structuredClone(stateRef.current);
      },
    });
    register({
      name: "move_table",
      description: "指定したテーブルを移動します。元に戻す操作に対応します。",
      inputSchema: {
        type: "object",
        properties: {
          table: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["table", "x", "y"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        if (
          !input ||
          Object.keys(input).some((k) => !["table", "x", "y"].includes(k)) ||
          typeof input.x !== "number" ||
          typeof input.y !== "number" ||
          !Number.isFinite(input.x) ||
          !Number.isFinite(input.y) ||
          Math.abs(input.x) > 3000 ||
          Math.abs(input.y) > 3000
        )
          throw new Error("有効なテーブルと座標を指定してください。");
        const next = structuredClone(stateRef.current),
          table = next.tables.find((t) => t.id === input.table);
        if (!table) throw new Error("テーブルがありません。");
        table.x = input.x;
        table.y = input.y;
        if (overlaps(table, next.tables))
          throw new Error("移動先でテーブルが重なります。");
        commit(next);
        return { table: table.id, x: table.x, y: table.y };
      },
    });
    return () => {
      context.unregisterTool?.("inspect_diagram");
      context.unregisterTool?.("move_table");
    };
  }, []);
  const pendingForeignKeys = state.tables.flatMap((table) =>
    (table.foreignKeys ?? [])
      .filter((fk) => !fk.target)
      .map((fk) => ({ table, fk })),
  );
  const edge = state.edges.find((e) => e.id === selected);
  const inspected = state.tables.find((t) => t.id === focusedTable);
  function selectTable(id: string) {
    setSelected(null);
    setAdjustingLine(false);
    setPending(null);
    setFocusedTable(id);
  }
  const selectedTable =
    edge && state.tables.find((t) => t.id === edge.to.table);
  const selectedFk = selectedTable?.foreignKeys?.find(
    (f) => f.id === edge?.foreignKeyId,
  );
  const edgeLabel =
    selectedFk && selectedTable && selectedFk.target
      ? `${selectedFk.name || "外部キー"}：${selectedFk.columnIds
          .map((id, i) => {
            const parent = state.tables.find(
              (t) => t.id === selectedFk.target!.tableId,
            )!;
            return `${displayTable(selectedTable)}.${displayColumn(selectedTable.columns.find((c) => c.id === id)!)} → ${displayTable(parent)}.${displayColumn(parent.columns.find((c) => c.id === selectedFk.target!.columnIds[i])!)}`;
          })
          .join(" / ")}`
      : "";
  return (
    <>
      <header className="editor-header">
        <div className="document-menu">
          <h1>
            <Logo />
            SimpleER
          </h1>
          <details
            ref={options}
            className="file-options"
            onClick={(e) => {
              if ((e.target as Element).closest("button") && options.current) {
                options.current.open = false;
                options.current.querySelector("summary")?.focus();
              }
            }}
          >
            <summary>ファイル</summary>
            <div className="file-options-panel">
              <button
                onClick={() => replace({ tables: [], edges: [] }, "", true)}
              >
                新しい図
              </button>
              <button onClick={() => file.current?.click()}>
                ファイルを開く
              </button>
              <button onClick={download}>ファイルに保存</button>
            </div>
          </details>
          <span
            className={`save-indicator${saveError || storageConflict ? " error" : ""}`}
            title={
              saveError || storageConflict
                ? "自動保存は停止中です"
                : "このブラウザに自動保存しています"
            }
          >
            {saveError || storageConflict ? "自動保存停止中" : "自動保存"}
          </span>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const input = e.currentTarget,
                selectedFile = input.files?.[0];
              if (!selectedFile) return;
              try {
                if (selectedFile.size > 2_000_000)
                  throw new Error("ファイルの上限は2MBです。");
                replace(decode(await selectedFile.text()), "", true);
              } catch (error) {
                setHint(
                  `読み込めませんでした：${messageOf(error)} 現在の図は保持しています。`,
                );
              } finally {
                input.value = "";
              }
            }}
          />
        </div>
        <nav className="editing-tools" aria-label="ER図の操作">
          <div className="history-tools" role="group" aria-label="編集履歴">
            {(["undo", "redo"] as const).map((kind, i) => (
              <button
                key={kind}
                id={kind}
                className="history-button"
                title={i ? "やり直す (⇧⌘Z)" : "元に戻す (⌘Z)"}
                aria-label={i ? "やり直す" : "元に戻す"}
                disabled={i ? !history.future.length : !history.past.length}
                onClick={i ? redo : undo}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path
                    d={
                      i
                        ? "m15 5 5 5-5 5 M20 10H10a6 6 0 0 0-6 6v3"
                        : "M9 5 4 10l5 5 M4 10h10a6 6 0 0 1 6 6v3"
                    }
                  />
                </svg>
              </button>
            ))}
          </div>
          <button
            className="primary"
            data-shortcut="T"
            title="テーブルを追加 (T)"
            onClick={() => open()}
          >
            <Icon name="plus" size={14} />
            テーブルを追加
          </button>
          <button
            title="名前から外部キーの候補を探す"
            onClick={() => setInfer(true)}
          >
            <Icon name="link" size={15} />
            自動で接続
          </button>
          <button
            disabled={state.tables.length < 2}
            title="テーブルの配置と間隔を整える"
            onClick={() => {
              try {
                replace(
                  tidyDiagram(state, view.current.w / view.current.h),
                  "",
                  true,
                );
              } catch (error) {
                setHint(messageOf(error));
              }
            }}
          >
            <Icon name="tidy" size={15} />
            整頓
          </button>
        </nav>
        <fieldset className="name-display">
          <legend>表示名</legend>
          <div className="name-segments">
            {([false, true] as const).map((isLogical) => (
              <label key={String(isLogical)}>
                <input
                  type="radio"
                  name="name-display"
                  value={isLogical ? "logical" : "physical"}
                  checked={logical === isLogical}
                  onChange={() => {
                    setLogical(isLogical);
                    try {
                      localStorage.setItem(
                        "er-sketch.name-display",
                        isLogical ? "logical" : "physical",
                      );
                    } catch {}
                  }}
                />
                <span>{isLogical ? "論理名" : "物理名"}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </header>
      <main>
        {storageConflict && (
          <div className="migration-notice" role="alert">
            別の画面でER図が変更されました。自動保存を停止しています。読み込む前に、この画面の図を「ファイルに保存」で残せます。読み込み時に編集履歴はリセットされます。
            <button
              onClick={() => {
                try {
                  const raw = localStorage.getItem(STORAGE);
                  if (!raw) {
                    setSaveError(
                      "別の画面で保存データが削除されました。この画面の図をファイルに保存してください。",
                    );
                    return;
                  }
                  const next = decodeDocument(raw);
                  dispatch({ type: "reset", next });
                  lastSaved.current = raw;
                  pausedSave.current = false;
                  setStorageConflict(false);
                  clear();
                  setSaveError("");
                  requestAnimationFrame(() =>
                    (
                      (document.querySelector(
                        ".migration-notice summary",
                      ) as HTMLElement | null) ?? document.getElementById("fit")
                    )?.focus(),
                  );
                } catch (e) {
                  setSaveError(messageOf(e));
                }
              }}
            >
              保存されている図を読み込む
            </button>
          </div>
        )}
        {pendingForeignKeys.length + (state.unresolvedEdges?.length ?? 0) >
          0 && (
          <details
            className="migration-notice"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.open = false;
                e.currentTarget.querySelector("summary")?.focus();
                e.stopPropagation();
              }
            }}
          >
            <summary>
              要確認{" "}
              {pendingForeignKeys.length + (state.unresolvedEdges?.length ?? 0)}
              件
              <span className="issue-counts">
                （参照先未設定 {pendingForeignKeys.length}・旧データの線{" "}
                {state.unresolvedEdges?.length ?? 0}）
              </span>
            </summary>
            <div className="issue-list">
              {pendingForeignKeys.map(({ table, fk }) => (
                <div className="issue-row" key={fk.id}>
                  <span>
                    {displayTable(table)}.
                    {fk.columnIds
                      .map((id) =>
                        displayColumn(table.columns.find((c) => c.id === id)!),
                      )
                      .join(", ")}{" "}
                    — 参照先未設定
                  </span>
                  <button
                    onClick={() => open(table.id, true, fk.id)}
                    aria-label={`${displayTable(table)}の${fk.name || fk.columnIds.map((id) => displayColumn(table.columns.find((c) => c.id === id)!)).join(", ")}の参照先を設定`}
                  >
                    編集
                  </button>
                </div>
              ))}
              {(state.unresolvedEdges?.length ?? 0) > 0 && (
                <p>
                  旧データの線は参照方向を確定できませんでした。番号は読み込み前のカラム位置です。必要な外部キーを設定してから破棄してください。破棄は再読み込みまで「元に戻す」で取り消せます。
                </p>
              )}
              {state.unresolvedEdges?.map((edge, index) => (
                <div className="issue-row" key={`${edge.id}:${index}`}>
                  <span>
                    旧データの線:{" "}
                    {state.tables.some((t) => t.id === edge.from.table)
                      ? displayTable(
                          state.tables.find((t) => t.id === edge.from.table)!,
                        )
                      : edge.from.table + "（削除済み）"}
                    （{edge.from.row + 1}列目）—{" "}
                    {state.tables.some((t) => t.id === edge.to.table)
                      ? displayTable(
                          state.tables.find((t) => t.id === edge.to.table)!,
                        )
                      : edge.to.table + "（削除済み）"}
                    （{edge.to.row + 1}列目）
                  </span>
                  <button
                    aria-label={`旧データの線${index + 1}を破棄`}
                    onClick={() => {
                      commit({
                        ...state,
                        unresolvedEdges: state.unresolvedEdges!.filter(
                          (_, i) => i !== index,
                        ),
                      });
                      setHint(
                        "旧データの線を1本破棄しました。「元に戻す」で復元できます。",
                      );
                      requestAnimationFrame(() => {
                        const target = document.querySelector(
                          ".migration-notice summary",
                        ) as HTMLElement | null;
                        (target ?? document.getElementById("fit"))?.focus();
                      });
                    }}
                  >
                    破棄
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="instruction" data-visible={Boolean(hint || saveError)}>
          <span role="status" aria-live="polite">
            {hint}
          </span>
          <span
            id="save-status"
            role="status"
            className={saveError ? "error" : ""}
          >
            {saveError}
          </span>
        </div>
        <div className="workspace">
          <Sidebar
            state={state}
            selectedTable={focusedTable}
            selectedForeignKey={edge?.foreignKeyId}
            displayTable={displayTable}
            displayColumn={displayColumn}
            onAdd={() => open()}
            onSelectTable={(id) => {
              selectTable(id);
              setRevealRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
            }}
            onSelectEdge={(id) => {
              clear();
              setSelected(id);
              const target = state.edges.find((e) => e.id === id)?.to.table;
              if (target)
                setRevealRequest((r) => ({ id: target, n: (r?.n ?? 0) + 1 }));
            }}
          />
          <DiagramCanvas
            state={state}
            selected={selected}
            selectedTable={focusedTable}
            onSelectTable={selectTable}
            revealRequest={revealRequest}
            adjustingLine={adjustingLine}
            onAdjustable={setAdjustable}
            pending={pending}
            displayTable={displayTable}
            displayColumn={displayColumn}
            onEdit={open}
            logical={logical}
            onRename={(id, columnId, value) => {
              const table = structuredClone(
                state.tables.find((t) => t.id === id)!,
              );
              if (columnId)
                table.columns.find((c) => c.id === columnId)![
                  logical ? "logicalName" : "name"
                ] = value;
              else if (logical) table.logicalName = value;
              else table.name = value;
              commit(editTable(state, table));
            }}
            onConnect={connect}
            onSelect={(id) => {
              clear();
              setSelected(id);
            }}
            onClear={clear}
            onHint={setHint}
            onCommit={commit}
            onPreview={(next) =>
              dispatch({ type: "preview", next: documentFromDiagram(next) })
            }
            fitRequest={fitRequest}
            viewRef={view}
          >
            <div id="selection" hidden={!edge}>
              <span id="edge-label">{edgeLabel}</span>
              <button
                aria-pressed={adjustingLine}
                disabled={!adjustable}
                onClick={() => setAdjustingLine((v) => !v)}
              >
                経路を調整
              </button>
              <button
                onClick={() => {
                  if (!edge) return;
                  const next = structuredClone(state);
                  for (const e of next.edges.filter(
                    (e) => e.foreignKeyId === edge.foreignKeyId,
                  )) {
                    e.trunk = null;
                    e.manual = false;
                  }
                  setAdjustingLine(false);
                  commit(next);
                }}
              >
                線を自動に戻す
              </button>
              <button
                onClick={() =>
                  edge && open(edge.to.table, true, edge.foreignKeyId)
                }
              >
                外部キーを編集
              </button>
              <button
                id="remove"
                onClick={() =>
                  edge?.foreignKeyId &&
                  replace(removeForeignKey(state, edge.foreignKeyId))
                }
              >
                外部キーを削除
              </button>
            </div>
          </DiagramCanvas>
          {inspected && (
            <Inspector
              key={inspected.id}
              table={inspected}
              state={state}
              logical={logical}
              displayTable={displayTable}
              displayColumn={displayColumn}
              onRename={(field, value) => {
                const table = structuredClone(inspected);
                table[field] = value;
                commit(editTable(state, table));
              }}
              onOpenEditor={() => open(inspected.id)}
              onClose={clear}
              onSelectForeignKey={(id) => {
                const target = state.edges.find((e) => e.foreignKeyId === id);
                if (!target) return;
                clear();
                setSelected(target.id);
              }}
            />
          )}
        </div>
      </main>
      {draft && (
        <TableEditor
          initial={draft}
          showConstraints={editConstraints}
          initialForeignKey={editingForeignKey}
          state={state}
          onClose={() => setDraft(null)}
          onApply={replace}
        />
      )}
      {infer && (
        <InferDialog
          state={state}
          onClose={() => setInfer(false)}
          onApply={replace}
        />
      )}
    </>
  );
}
