import { isImeKey } from "../shared/ime.ts";
import { watchStorage } from "../shared/storage.ts";
import { checkDiagram, DiagramChanged } from "../shared/diagram-library.ts";
import type { DiagramEntry, OpenDiagram } from "../shared/diagram-library.ts";
import { DiagramList } from "../shared/DiagramList.tsx";
import { TextField } from "../shared/TextField.tsx";
import { library, emptyDocument, namedDocument, untitled } from "./library.ts";
import { downloadFile, downloadPng } from "../shared/export.ts";
import { diagramSvg, exportFilename, titleFromFile } from "./export.ts";
import { DdlImportDialog } from "./DdlImportDialog.tsx";
import { diagramDDL } from "./ddl.ts";
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
import {
  canConnect,
  createColumn,
  removeForeignKey,
  removeTable,
  editTable,
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
import {
  TableEditor,
  InferDialog,
  HelpDialog,
  SampleDialog,
} from "./Dialogs.tsx";
import { loadSample, samples } from "./samples.ts";
import { Sidebar } from "./Panels.tsx";
import { Icon, Logo } from "./icons.tsx";

type SavedDiagram = OpenDiagram<DiagramDocument>;

export function App() {
  const [session, setSession] = useState(() => ({
    initial: library.restoreDiagram(),
    visit: 0,
    before: undefined as DiagramDocument | undefined,
    message: "",
  }));
  return (
    <Editor
      key={session.visit}
      {...session}
      onOpen={(initial, message = "", before) =>
        setSession((old) => ({
          initial,
          message,
          before,
          visit: old.visit + 1,
        }))
      }
    />
  );
}

function Editor({
  initial,
  before,
  visit,
  message,
  onOpen,
}: {
  initial: SavedDiagram;
  before?: DiagramDocument;
  visit: number;
  message: string;
  onOpen: (
    next: SavedDiagram,
    message?: string,
    before?: DiagramDocument,
  ) => void;
}) {
  const [history, dispatch] = useReducer(historyReducer, {
    present: initial.doc,
    past: before ? [before] : [],
    future: [],
  });
  const state = useMemo(
    () => projectDocument(history.present),
    [history.present],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [focusedTable, setFocusedTable] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(() => {
    try {
      return localStorage.getItem("er-sketch.sidebar") === "open";
    } catch {
      return false;
    }
  });
  const [revealRequest, setRevealRequest] = useState<{
    id: string;
    n: number;
    nearest?: boolean;
  } | null>(null);
  const [adjustingLine, setAdjustingLine] = useState(false);
  const [adjustable, setAdjustable] = useState(false);
  const [pending, setPending] = useState<Endpoint | null>(null);
  const [hint, setHint] = useState(message);
  const [saveError, setSaveError] = useState(initial.error || "");
  const [conflict, setConflict] = useState<DiagramChanged | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const pausedSave = useRef(!!initial.error);
  const lastSaved = useRef(initial);
  const currentDoc = useRef(history.present);
  currentDoc.current = history.present;
  const mounted = useRef(true);
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
  const [ddlImport, setDdlImport] = useState(false);
  const [help, setHelp] = useState(false);
  const [sampleList, setSampleList] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [fitRequest, setFitRequest] = useState(visit > 0 ? 1 : 0);
  const view = useRef<View>({ x: 0, y: 0, w: 1200, h: 720, zoom: 100 });
  const file = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const displayTable = (t: Table) =>
    logical && t.logicalName ? t.logicalName : title(t);
  const displayColumn = (c: Column) =>
    logical && c.logicalName ? c.logicalName : c.name;
  function pause(raw: string | null) {
    pausedSave.current = true;
    setConflict(new DiagramChanged(raw));
    setSaveError("");
  }
  function isSaved(doc: DiagramDocument) {
    const saved = lastSaved.current.doc;
    return doc === saved || JSON.stringify(doc) === JSON.stringify(saved);
  }
  function persist(doc: DiagramDocument) {
    if (pausedSave.current)
      throw new Error("この画面の編集を別の図として保存してください。");
    try {
      const saved = lastSaved.current;
      if (saved.raw !== null && isSaved(doc))
        checkDiagram(initial.key, saved.raw);
      else
        lastSaved.current = library.writeDiagram(initial.key, doc, saved.raw);
      setSaveError("");
    } catch (e) {
      if (e instanceof DiagramChanged) pause(e.raw);
      else setSaveError(messageOf(e));
      throw e;
    }
  }
  function save(next: DiagramDocument) {
    currentDoc.current = next;
    if (pausedSave.current) return;
    try {
      persist(next);
    } catch {
      /* persist displays the save error. */
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (!initial.error && initial.raw === null) save(initial.doc);
    library.rememberDiagram(initial.key);
    const unwatch = watchStorage(
      initial.key,
      () => lastSaved.current.raw,
      pause,
    );
    window.addEventListener("beforeunload", flushTitle);
    if (visit) options.current?.querySelector("summary")?.focus();
    return () => {
      mounted.current = false;
      unwatch();
      window.removeEventListener("beforeunload", flushTitle);
    };
  }, []);
  useEffect(() => {
    document.title = (history.present.title || untitled) + " — SimpleER";
  }, [history.present.title]);
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
  function flushTitle() {
    const input = document.activeElement;
    if (input instanceof HTMLInputElement && input.closest(".document-title"))
      input.blur();
  }
  function saveBeforeSwitch() {
    flushTitle();
    if (pausedSave.current && isSaved(currentDoc.current)) return;
    persist(currentDoc.current);
  }
  function createDiagram(
    doc: DiagramDocument,
    message: string,
    before?: DiagramDocument,
  ) {
    if (!mounted.current) return;
    saveBeforeSwitch();
    onOpen(
      library.writeDiagram(library.newDiagramKey(), doc, null),
      message,
      before,
    );
  }
  function newDiagram() {
    createDiagram(emptyDocument(), "新しい図を作成しました");
  }
  function runMenu(action: () => void) {
    try {
      action();
    } catch (e) {
      setHint(messageOf(e));
    }
  }
  function showList() {
    flushTitle();
    save(currentDoc.current);
    setListOpen(true);
  }
  function closeList() {
    setListOpen(false);
    requestAnimationFrame(() =>
      options.current?.querySelector("summary")?.focus(),
    );
  }
  function renameDiagram(entry: DiagramEntry, title: string) {
    const active = entry.key === initial.key;
    const source = active
      ? lastSaved.current
      : library.openDiagram(entry.key, entry.raw);
    if (source.error || (active && pausedSave.current))
      throw new Error("図を開いて保存データを確認してください。");
    if (active) checkDiagram(entry.key, lastSaved.current.raw);
    const current = active ? currentDoc.current : source.doc;
    if (current.title === title) return;
    const doc = { ...current, title };
    const next = library.writeDiagram(entry.key, doc, entry.raw);
    if (active) {
      lastSaved.current = next;
      currentDoc.current = doc;
      dispatch({ type: "commit", next: doc });
      setSaveError("");
    }
  }
  async function openSample(index: number) {
    setSampleList(false);
    try {
      const doc = decodeDocument(await loadSample(index));
      createDiagram(
        namedDocument(doc, samples[index].name),
        "サンプルを開きました",
      );
    } catch (error) {
      setHint(messageOf(error));
    }
  }
  function undo() {
    if (!history.past.length) return;
    dispatch({ type: "undo" });
    save(history.past.at(-1)!);
    clear();
    // Keep the table selection; it is ignored once the table disappears.
    setFocusedTable(focusedTable);
  }
  function redo() {
    if (!history.future.length) return;
    dispatch({ type: "redo" });
    save(history.future.at(-1)!);
    clear();
    // Keep the table selection; it is ignored once the table disappears.
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
      if (isImeKey(e)) return;
      if (e.key === "Escape" && options.current?.open) {
        options.current.open = false;
        options.current.querySelector("summary")?.focus();
        return;
      }
      if (
        draft ||
        infer ||
        help ||
        ddlImport ||
        sampleList ||
        listOpen ||
        (e.target instanceof Element &&
          e.target.matches("input,select,textarea"))
      )
        return;
      if (e.key === "Escape") clear();
      if (
        e.key === "?" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target instanceof Element && e.target.closest("[contenteditable]"))
      ) {
        e.preventDefault();
        setHelp(true);
        return;
      }
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
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (edge?.foreignKeyId) {
          e.preventDefault();
          replace(
            removeForeignKey(state, edge.foreignKeyId),
            "外部キーを削除しました。「元に戻す」で復元できます。",
          );
        } else if (focused) {
          e.preventDefault();
          const { next, incoming } = removeTable(state, focused.id);
          replace(
            next,
            `${focused.name || focused.id}を削除しました。${incoming ? `外部キー${incoming}件は参照先未設定として「要確認」に残しています。` : ""}「元に戻す」で復元できます。`,
          );
        }
        return;
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
    // Clicks within one table re-pick the source; self-references are set in the editor.
    if (pending.table === table) {
      setPending(pending.row === row ? null : { table, row });
      setHint("");
      return;
    }
    link(pending, { table, row });
  }
  /** Register a foreign key between two columns (key side is detected). */
  function link(source: Endpoint, { table, row }: Endpoint) {
    if (source.table === table) {
      setPending(null);
      setHint(
        "同じテーブル内の参照（自己参照）は、テーブル編集の「参照先」から設定してください。",
      );
      return;
    }
    if (
      !canConnect(state, source, { table, row }) &&
      !canConnect(state, { table, row }, source)
    ) {
      setHint(
        "参照先の主キー・一意制約と参照元カラムを選んでください。複合キーは編集画面で設定できます。",
      );
      return;
    }
    if (
      state.edges.some(
        (e) =>
          (e.from.table === source.table &&
            e.from.row === source.row &&
            e.to.table === table &&
            e.to.row === row) ||
          (e.to.table === source.table &&
            e.to.row === source.row &&
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
      const edge = makeEdge(next, source, { table, row });
      commit({ ...next, edges: [...next.edges, edge] });
      clear();
      setSelected(edge.id);
    } catch (error) {
      setPending(null);
      setHint(messageOf(error));
    }
  }
  async function download(format: "json" | "svg" | "png" | "sql") {
    flushTitle();
    const doc = currentDoc.current;
    const diagram = projectDocument(doc);
    const name = exportFilename(doc.title) + "." + format;
    try {
      if (format === "json") downloadFile(encodeDocument(doc), name);
      else if (format === "sql")
        downloadFile(
          diagramDDL(diagram),
          name,
          "application/sql;charset=utf-8",
        );
      else {
        const svg = diagramSvg(diagram, displayTable, displayColumn);
        if (format === "svg")
          downloadFile(svg, name, "image/svg+xml;charset=utf-8");
        else {
          setExportingPng(true);
          await downloadPng(svg, name);
        }
      }
      setHint("");
    } catch (error) {
      setHint(`保存できませんでした：${messageOf(error)}`);
    } finally {
      if (format === "png") setExportingPng(false);
    }
  }
  async function copyDDL() {
    try {
      await navigator.clipboard.writeText(diagramDDL(state));
      setHint("全テーブルの DDL をコピーしました。");
    } catch {
      setHint(
        "コピーできませんでした。ファイルメニューから DDL を保存できます。",
      );
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
  const focused = state.tables.find((t) => t.id === focusedTable);
  const pendingTable = pending
    ? state.tables.find((t) => t.id === pending.table)
    : undefined;
  const pendingColumn = pending
    ? pendingTable?.columns[pending.row]
    : undefined;
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
          <button
            className="icon-button sidebar-toggle"
            aria-label="テーブル一覧"
            aria-pressed={showSidebar}
            title={showSidebar ? "テーブル一覧を閉じる" : "テーブル一覧を開く"}
            onClick={() => {
              setShowSidebar(!showSidebar);
              try {
                localStorage.setItem(
                  "er-sketch.sidebar",
                  showSidebar ? "closed" : "open",
                );
              } catch {}
            }}
          >
            <Icon name="sidebar" />
          </button>
          <div className="document-identity">
            <h1>
              <Logo />
              SimpleER
            </h1>
            <TextField
              className="document-title"
              label="図の名前"
              cancelOnEscape
              value={history.present.title || untitled}
              emptyValue={untitled}
              onCommit={(title) => {
                if (currentDoc.current.title === title) return;
                const next = { ...currentDoc.current, title };
                dispatch({ type: "commit", next });
                save(next);
              }}
            />
          </div>
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
              <button onClick={showList}>図の一覧</button>
              <button onClick={() => runMenu(newDiagram)}>新しい図</button>
              <button onClick={() => file.current?.click()}>
                ファイルを開く
              </button>
              <button onClick={() => setDdlImport(true)}>DDL を読み込む</button>
              <button onClick={() => download("json")}>ファイルに保存</button>
              <hr />
              <button
                disabled={!state.tables.length}
                onClick={() => download("svg")}
              >
                SVG で保存
              </button>
              <button
                disabled={!state.tables.length || exportingPng}
                onClick={() => download("png")}
              >
                {exportingPng ? "PNG に変換中…" : "PNG で保存"}
              </button>
              <button disabled={!state.tables.length} onClick={copyDDL}>
                全テーブルの DDL をコピー
              </button>
              <button
                disabled={!state.tables.length}
                onClick={() => download("sql")}
              >
                全テーブルの DDL を保存
              </button>
              <hr />
              <button onClick={() => setSampleList(true)}>
                サンプルを開く
              </button>
              <button onClick={() => setHelp(true)}>
                使い方 <kbd className="kbd">?</kbd>
              </button>
            </div>
          </details>
          {(saveError || conflict || initial.error) && (
            <span className="save-indicator error" title="自動保存は停止中です">
              自動保存停止中
            </span>
          )}
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
                const doc = decodeDocument(await selectedFile.text());
                createDiagram(
                  namedDocument(doc, titleFromFile(selectedFile.name)),
                  "ファイルを開きました",
                );
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
        {(conflict || (initial.error && initial.raw !== null)) && (
          <div className="migration-notice" role="alert">
            {conflict && (
              <>
                {conflict.message}
                自動保存を停止しています。この画面の編集は「別の図として保存」で残せます。
                {conflict.raw !== null && (
                  <button
                    onClick={() =>
                      runMenu(() => onOpen(library.openDiagram(initial.key)))
                    }
                  >
                    保存されている図を読み込む
                  </button>
                )}
              </>
            )}
            {initial.error && initial.raw !== null && (
              <button
                onClick={() =>
                  downloadFile(initial.raw!, "simple-er-recovery.json")
                }
              >
                元データをファイルに保存
              </button>
            )}
            <button
              onClick={() =>
                runMenu(() => {
                  const next = library.writeDiagram(
                    library.newDiagramKey(),
                    currentDoc.current,
                    null,
                  );
                  onOpen(next, "別の図として保存しました");
                })
              }
            >
              別の図として保存
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
            {hint !== saveError && hint}
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
          {showSidebar && (
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
          )}
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
            onSaveName={(original, target, value) => {
              const table = structuredClone(original);
              const field = logical ? "logicalName" : "name";
              if (target.kind === "add") {
                const column = createColumn(table.columns);
                column[field] = value;
                table.columns.push(column);
              } else if (target.kind === "column") {
                table.columns.find((c) => c.id === target.id)![field] = value;
              } else {
                table[field] = value;
              }
              const next = editTable(state, table);
              if (target.kind === "add" && overlaps(table, state.tables))
                throw new Error("近くのテーブルを移動してください。");
              commit(next);
            }}
            onUndo={undo}
            onRedo={redo}
            onConnect={connect}
            onLink={link}
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
            {!state.tables.length && (
              <div className="empty-diagram">
                <h2>空の図</h2>
                <div className="empty-actions">
                  <button className="primary" onClick={() => open()}>
                    <Icon name="plus" size={14} />
                    テーブルを追加
                    <kbd className="kbd">T</kbd>
                  </button>
                  <button onClick={() => file.current?.click()}>
                    ファイルを開く
                  </button>
                  <button onClick={() => setDdlImport(true)}>
                    DDL を読み込む
                  </button>
                  <button onClick={() => setSampleList(true)}>
                    サンプルを開く
                  </button>
                </div>
              </div>
            )}
            {pendingTable && pendingColumn && (
              <div className="connect-hint" role="status">
                <span className="mono">
                  {displayTable(pendingTable)}.{displayColumn(pendingColumn)}
                </span>
                の接続先を、別のテーブルのカラムから選んでください
                <kbd className="kbd">Esc</kbd>
                <span className="connect-hint-note">で取り消し</span>
              </div>
            )}
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
                data-shortcut="⌫"
                title="外部キーを削除 (Delete)"
                onClick={() =>
                  edge?.foreignKeyId &&
                  replace(removeForeignKey(state, edge.foreignKeyId))
                }
              >
                外部キーを削除
              </button>
            </div>
          </DiagramCanvas>
        </div>
      </main>
      {draft && (
        <TableEditor
          initial={draft}
          showConstraints={editConstraints}
          initialForeignKey={editingForeignKey}
          state={state}
          onClose={() => setDraft(null)}
          onApply={(next, message, created) => {
            replace(next, message);
            // Keep the zoom and pan only far enough to show the new table.
            if (created)
              setRevealRequest((r) => ({
                id: draft.id,
                n: (r?.n ?? 0) + 1,
                nearest: true,
              }));
          }}
        />
      )}
      {ddlImport && (
        <DdlImportDialog
          state={state}
          onClose={() => setDdlImport(false)}
          onApply={(diagram, separate, title, count) => {
            const message = count
              ? `${count}個のテーブルを読み込みました。`
              : "DDL を読み込みました。";
            if (separate) {
              const doc = namedDocument(documentFromDiagram(diagram), title);
              createDiagram(doc, message, {
                ...emptyDocument(),
                title: doc.title,
              });
            } else replace(diagram, message, true);
          }}
        />
      )}
      {infer && (
        <InferDialog
          state={state}
          onClose={() => setInfer(false)}
          onApply={replace}
        />
      )}
      {listOpen && (
        <DiagramList
          library={library}
          Icon={Icon}
          emptyName="空の図"
          activeKey={initial.key}
          onClose={closeList}
          onCreate={newDiagram}
          onOpen={(entry) => {
            if (entry.key === initial.key) return closeList();
            saveBeforeSwitch();
            onOpen(library.openDiagram(entry.key));
          }}
          onDuplicate={(entry) => {
            const source =
              entry.key === initial.key
                ? lastSaved.current
                : library.openDiagram(entry.key);
            if (source.error) throw new Error(source.error);
            const doc =
              entry.key === initial.key ? currentDoc.current : source.doc;
            createDiagram(
              {
                ...doc,
                title: (doc.title || untitled).slice(0, 196) + "のコピー",
              },
              "図を複製しました",
            );
          }}
          onRename={renameDiagram}
          onDelete={(entry) => {
            const next = library.deleteDiagram(entry, initial.key);
            if (next) onOpen(next, "図を削除しました");
            else {
              setHint("");
              save(currentDoc.current);
            }
          }}
        />
      )}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {sampleList && (
        <SampleDialog
          onClose={() => setSampleList(false)}
          onOpen={openSample}
        />
      )}
    </>
  );
}
