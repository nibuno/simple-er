import { messageOf, overlaps } from "./utils.ts";
import { useEffect, useReducer, useRef, useState } from "react";
import type { Column, Diagram, Endpoint, Table, View } from "./types.ts";
import { initial } from "./initial.ts";
import {
  canConnect,
  decode,
  encode,
  makeEdge,
  title,
  uid,
  validateDiagram,
} from "./model.ts";
import { tableWidth } from "./geometry.ts";
import { tidyDiagram } from "./layout.ts";
import { historyReducer } from "./history.ts";
import { DiagramCanvas } from "./DiagramCanvas.tsx";
import { TableEditor, InferDialog } from "./Dialogs.tsx";

const STORAGE = "er-sketch.local.v1";
function restore() {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved)
      try {
        return { diagram: decode(saved), message: "" };
      } catch {
        localStorage.setItem(STORAGE + ".recovery", saved);
        return {
          diagram: initial,
          message:
            "保存データを読み込めませんでした。元データを退避し、サンプルを表示しています。",
        };
      }
  } catch {
    return {
      diagram: initial,
      message: "自動保存を利用できません。ファイルに保存してください",
    };
  }
  return { diagram: initial, message: "" };
}
export function App() {
  const [loaded] = useState(restore);
  const [history, dispatch] = useReducer(historyReducer, {
    present: loaded.diagram,
    past: [],
    future: [],
  });
  const state = history.present;
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Endpoint | null>(null);
  const [hint, setHint] = useState(loaded.message);
  const [saveError, setSaveError] = useState("");
  const [logical, setLogical] = useState(() => {
    try {
      return localStorage.getItem("er-sketch.name-display") === "logical";
    } catch {
      return false;
    }
  });
  const [draft, setDraft] = useState<Table | null>(null);
  const [infer, setInfer] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const view = useRef<View>({ x: 0, y: 0, w: 1200, h: 720, zoom: 100 });
  const file = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const displayTable = (t: Table) =>
    logical && t.logicalName ? t.logicalName : title(t);
  const displayColumn = (c: Column) => (logical && c[4] ? c[4] : c[0]);
  function save(next: Diagram) {
    try {
      localStorage.setItem(STORAGE, encode(next));
      setSaveError("");
    } catch {
      setSaveError("自動保存できません。ファイルに保存してください");
    }
  }
  function commit(next: Diagram, before?: Diagram) {
    const valid = validateDiagram(next);
    dispatch({ type: "commit", next: valid, before });
    save(valid);
  }
  function clear() {
    setSelected(null);
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
  }
  function redo() {
    if (!history.future.length) return;
    dispatch({ type: "redo" });
    save(history.future.at(-1)!);
    clear();
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  function open(id?: string) {
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
      columns: [["id", "uuid", "PK", uid(), ""]],
    };
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
    if (!state.tables.find((t) => t.id === table)!.columns[row][2]) {
      setHint(
        "接続するカラムは「編集」で外部キー（FK）または主キー（PK）を設定してください。",
      );
      return;
    }
    if (!pending) {
      setPending({ table, row });
      setSelected(null);
      setHint(
        "対応する主キー（PK）または外部キー（FK）を選んでください。Escでキャンセル。",
      );
      return;
    }
    if (!canConnect(state, pending, { table, row })) {
      setHint("主キー（PK）と外部キー（FK）の組み合わせを選んでください。");
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
    const edge = makeEdge(state, pending, { table, row });
    commit({ ...state, edges: [...state.edges, edge] });
    clear();
    setSelected(edge.id);
  }
  function download() {
    try {
      const url = URL.createObjectURL(
        new Blob([encode(state)], { type: "application/json" }),
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
  const edge = state.edges.find((e) => e.id === selected);
  const edgeLabel = edge
    ? [edge.from, edge.to]
        .map((p) => {
          const t = state.tables.find((t) => t.id === p.table)!;
          return `${displayTable(t)}.${displayColumn(t.columns[p.row])}`;
        })
        .join(" — ")
    : "";
  return (
    <>
      <header className="editor-header">
        <div className="document-menu">
          <h1>SimpleER</h1>
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
                title={i ? "やり直す" : "元に戻す"}
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
          <button className="primary" onClick={() => open()}>
            テーブルを追加
          </button>
          <button onClick={() => setInfer(true)}>自動で接続</button>
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
        <DiagramCanvas
          state={state}
          selected={selected}
          pending={pending}
          displayTable={displayTable}
          displayColumn={displayColumn}
          onEdit={open}
          onConnect={connect}
          onSelect={(id) => {
            clear();
            setSelected(id);
          }}
          onClear={clear}
          onHint={setHint}
          onCommit={commit}
          onPreview={(next) => dispatch({ type: "preview", next })}
          fitRequest={fitRequest}
          viewRef={view}
        >
          <div id="selection" hidden={!edge}>
            <span id="edge-label">{edgeLabel}</span>
            <button
              onClick={() => {
                if (!edge) return;
                const next = structuredClone(state),
                  e = next.edges.find((e) => e.id === edge.id)!,
                  a = state.tables.find((t) => t.id === e.from.table)!,
                  b = state.tables.find((t) => t.id === e.to.table)!;
                e.trunk =
                  (a.x + tableWidth(a) / 2 + b.x + tableWidth(b) / 2) / 2;
                e.manual = false;
                commit(next);
              }}
            >
              線を自動に戻す
            </button>
            <button
              id="remove"
              onClick={() =>
                replace({
                  ...state,
                  edges: state.edges.filter((e) => e.id !== selected),
                })
              }
            >
              接続を削除
            </button>
          </div>
        </DiagramCanvas>
      </main>
      {draft && (
        <TableEditor
          initial={draft}
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
