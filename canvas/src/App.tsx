import { watchStorage } from "../../shared/storage.ts";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  CanvasDocument,
  CanvasNode,
  CanvasEdge,
  NodeShape,
  Point,
  Tool,
} from "./types";
import {
  arrange,
  attachNote,
  bounds,
  clone,
  decode,
  emptyDocument,
  encode,
  fitGroup,
  groupSelection,
  growNodes,
  historyReducer,
  makeNode,
  MAX_EDGES,
  MAX_NODES,
  moveNodes,
  pasteDocument,
  placeInFreeSpace,
  removeSelection,
  sampleDocument,
  selectionDocument,
  STORAGE_KEY,
  uid,
} from "./model";
import { downloadFile, exportPng, filename, toSvg } from "./export";
import { Canvas } from "./Canvas";
import type { CanvasHandle } from "./Canvas";
import { SelectionBar, TextField } from "./Inspector";
import { Icon } from "./Icons";
import { SHAPES, shapeIcons, shapeLabels } from "./shapes";

function boot() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return {
      doc: raw ? decode(raw) : growNodes(sampleDocument()),
      saved: raw,
      error: "",
      raw: null as string | null,
    };
  } catch (error) {
    return {
      doc: emptyDocument(),
      saved: raw,
      error: raw
        ? "保存済みのデータを読み込めませんでした。元のデータは上書きせずに保持しています。"
        : "このブラウザでは自動保存を利用できません。ファイルに保存して作業を残してください。",
      raw,
    };
  }
}
const isTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest("input,textarea,select,[contenteditable='true']");
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const SHORT_SAVE_STATES: Record<string, string> = {
  このブラウザに保存済み: "保存済み",
  自動保存を停止中: "保存停止中",
  自動保存できません: "保存できません",
};
export function App() {
  const initial = useRef<ReturnType<typeof boot> | null>(null);
  if (!initial.current) initial.current = boot();
  const [history, dispatch] = useReducer(historyReducer, {
    present: initial.current.doc,
    past: [],
    future: [],
  });
  const [draftNode, setDraftNode] = useState<CanvasNode | null>(null),
    draftRef = useRef<CanvasNode | null>(null);
  // A figure added by dropping a line on empty space keeps that line as part
  // of the draft, so it is added or discarded together with the figure.
  const [draftEdge, setDraftEdge] = useState<CanvasEdge | null>(null),
    draftEdgeRef = useRef<CanvasEdge | null>(null);
  const doc = useMemo(
    () =>
      draftNode
        ? {
            ...history.present,
            nodes: [...history.present.nodes, draftNode],
            edges: draftEdge
              ? [...history.present.edges, draftEdge]
              : history.present.edges,
          }
        : history.present,
    [history.present, draftNode, draftEdge],
  );
  const docRef = useRef(history.present);
  docRef.current = history.present;
  const historyRef = useRef(history);
  historyRef.current = history;
  const [selection, setSelection] = useState<string[]>([]),
    selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [tool, setTool] = useState<Tool>("select"),
    [shape, setShape] = useState<NodeShape>("rectangle"),
    [pending, setPending] = useState<string | null>(null),
    pendingRef = useRef<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null),
    [status, setStatus] = useState(""),
    [error, setError] = useState(initial.current.error);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [saveState, setSaveState] = useState(""),
    [dirty, setDirty] = useState(false),
    [paused, setPaused] = useState(!!initial.current.raw);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [recovery, setRecovery] = useState(initial.current.raw),
    [remote, setRemote] = useState<string | null>(null),
    [exporting, setExporting] = useState(false);
  const saveText = paused
    ? "自動保存を停止中"
    : dirty || editing
      ? "編集中"
      : saveState;
  const canvas = useRef<CanvasHandle>(null),
    file = useRef<HTMLInputElement>(null),
    menu = useRef<HTMLDetailsElement>(null),
    help = useRef<HTMLDialogElement>(null);
  const lastSaved = useRef<string | null>(initial.current.saved),
    actions = useRef({
      undo: () => {},
      redo: () => {},
      add: (_kind: "box" | "note", _point?: Point, _shape?: NodeShape) => {},
      duplicate: () => {},
      remove: () => {},
      group: () => {},
      save: () => {},
      connectMode: () => {},
      fit: () => {},
    });
  function flushInput() {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (isTyping(active) || active.closest(".inline-editor"))
    )
      active.blur();
  }
  function setDraft(node: CanvasNode | null, edge: CanvasEdge | null = null) {
    draftRef.current = node;
    draftEdgeRef.current = edge;
    setDraftNode(node);
    setDraftEdge(edge);
  }
  function discardDraft() {
    const id = draftRef.current?.id;
    setDraft(null);
    setEditing(null);
    setDirty(false);
    if (id) {
      selectionRef.current = selectionRef.current.filter(
        (selected) => selected !== id,
      );
      setSelection(selectionRef.current);
    }
  }
  function select(ids: string[]) {
    flushInput();
    setInspectorOpen(true);
    setSelection(ids);
    selectionRef.current = ids;
  }
  function clearPending() {
    pendingRef.current = null;
    setPending(null);
  }
  function notify(message: string) {
    setStatus(message);
  }
  // Messages are short confirmations; they leave on their own.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 4000);
    return () => clearTimeout(timer);
  }, [status]);
  function commit(next: CanvasDocument, before?: CanvasDocument) {
    try {
      growNodes(next);
      // Validate edits as well as imports, so every saved document is reloadable.
      const valid = decode(encode(next));
      docRef.current = valid;
      const action = { type: "commit" as const, next: valid, before };
      historyRef.current = historyReducer(historyRef.current, action);
      dispatch(action);
      setDirty(false);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      if (before) {
        docRef.current = before;
        historyRef.current = historyReducer(historyRef.current, {
          type: "preview",
          next: before,
        });
        dispatch({ type: "preview", next: before });
      }
      return false;
    }
  }
  function patchNode(id: string, patch: Partial<CanvasNode>) {
    if (draftRef.current?.id === id) {
      const node = { ...draftRef.current, ...patch };
      if (
        ![node.title, node.description, node.body].some((text) => text.trim())
      ) {
        discardDraft();
        return;
      }
      const next = clone(docRef.current);
      next.nodes.push(node);
      if (draftEdgeRef.current) next.edges.push(draftEdgeRef.current);
      if (commit(next)) setDraft(null);
      return;
    }
    const next = clone(docRef.current),
      node = next.nodes.find((n) => n.id === id);
    if (!node) return;
    if (node.attachedTo && patch.body !== undefined) {
      next.nodes.find((n) => n.id === node.attachedTo)!.body = patch.body;
    } else Object.assign(node, patch);
    commit(next);
  }
  function patchEdge(id: string, patch: Partial<CanvasEdge>) {
    const next = clone(docRef.current),
      edge = next.edges.find((e) => e.id === id);
    if (edge) {
      Object.assign(edge, patch);
      commit(next);
    }
  }
  function patchColors(
    patch: Pick<Partial<CanvasNode>, "fillColor" | "strokeColor">,
  ) {
    flushInput();
    const next = clone(docRef.current);
    next.nodes.forEach((node) => {
      if (selectionRef.current.includes(node.id)) Object.assign(node, patch);
    });
    if ("strokeColor" in patch)
      next.edges.forEach((edge) => {
        if (selectionRef.current.includes(edge.id))
          edge.strokeColor = patch.strokeColor;
      });
    commit(next);
  }
  function edit(id: string | null) {
    if (!id && draftRef.current) {
      discardDraft();
      return;
    }
    if (id) flushInput();
    else setInspectorOpen(false);
    setEditing(id);
    setDirty(!!id);
    if (id) select([id]);
  }
  function add(
    kind: "box" | "note",
    point?: Point,
    nodeShape = shape,
    from?: string,
  ) {
    flushInput();
    discardDraft();
    const next = clone(docRef.current);
    if (next.nodes.length >= MAX_NODES) {
      setError("要素は150個まで追加できます。");
      return;
    }
    if (from && next.edges.length >= MAX_EDGES) {
      setError("接続線は400本まで追加できます。");
      return;
    }
    const center = point || canvas.current?.center() || { x: 100, y: 100 },
      node = makeNode(kind, center, nodeShape);
    // A dropped line places the figure centered on the drop point.
    if (!point || from) {
      node.x = Math.round((node.x - node.w / 2) / 8) * 8;
      node.y = Math.round((node.y - node.h / 2) / 8) * 8;
    }
    if (!point) placeInFreeSpace(node, next);
    setDraft(
      node,
      from ? { id: uid(), from, to: node.id, label: "", dashed: false } : null,
    );
    clearPending();
    setTool("select");
    select([node.id]);
    setEditing(node.id);
  }
  function connect(id: string, fromOverride?: string) {
    flushInput();
    if (docRef.current.nodes.find((n) => n.id === id)?.kind === "group") {
      notify("図形またはメモを選んでください。");
      return;
    }
    const from = fromOverride ?? pendingRef.current;
    if (!from) {
      pendingRef.current = id;
      setPending(id);
      select([id]);
      notify("接続先を選んでください。Escで取り消せます。");
      return;
    }
    if (from === id) {
      clearPending();
      notify("接続を取り消しました。");
      return;
    }
    if (docRef.current.edges.some((e) => e.from === from && e.to === id)) {
      clearPending();
      notify("この向きの接続線はすでにあります。");
      return;
    }
    if (docRef.current.edges.length >= MAX_EDGES) {
      setError("接続線は400本まで追加できます。");
      clearPending();
      return;
    }
    const next = clone(docRef.current),
      edge = { id: uid(), from, to: id, label: "", dashed: false };
    next.edges.push(edge);
    commit(next);
    clearPending();
    setTool("select");
    select([edge.id]);
    notify("接続しました。ラベルも付けられます。");
  }
  function remove() {
    flushInput();
    if (!selectionRef.current.length) return;
    commit(removeSelection(docRef.current, selectionRef.current));
    select([]);
    edit(null);
    clearPending();
    notify("削除しました。元に戻せます。");
  }
  function duplicate() {
    flushInput();
    try {
      const result = pasteDocument(
        docRef.current,
        selectionDocument(docRef.current, selectionRef.current),
        { x: 40, y: 40 },
      );
      commit(result.doc);
      select(result.ids);
      notify("複製しました。");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function group() {
    flushInput();
    try {
      const result = groupSelection(docRef.current, selectionRef.current);
      commit(result.doc);
      select([result.id]);
      notify("選んだ要素を囲みました。");
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  function undo() {
    if (draftRef.current) {
      discardDraft();
      return;
    }
    flushInput();
    const next = historyReducer(historyRef.current, { type: "undo" });
    docRef.current = next.present;
    historyRef.current = next;
    dispatch({ type: "undo" });
    setEditing(null);
    setDirty(false);
    clearPending();
    notify("元に戻しました。");
  }
  function redo() {
    if (draftRef.current) {
      discardDraft();
      return;
    }
    flushInput();
    const next = historyReducer(historyRef.current, { type: "redo" });
    docRef.current = next.present;
    historyRef.current = next;
    dispatch({ type: "redo" });
    setEditing(null);
    setDirty(false);
    clearPending();
    notify("やり直しました。");
  }
  function save() {
    flushInput();
    downloadFile(
      encode(docRef.current),
      filename(docRef.current.title) + ".simplecanvas.json",
    );
    notify("ファイルを保存しました。");
  }
  function replace(next: CanvasDocument) {
    flushInput();
    discardDraft();
    commit(next);
    select([]);
    setEditing(null);
    clearPending();
    setTool("select");
    requestAnimationFrame(() => canvas.current?.fit());
  }
  function connectMode() {
    flushInput();
    clearPending();
    setTool((old) => (old === "connect" ? "select" : "connect"));
    notify("接続元、接続先の順に選んでください。");
  }
  actions.current = {
    undo,
    redo,
    add,
    duplicate,
    remove,
    group,
    save,
    connectMode,
    fit: () => canvas.current?.fit(),
  };
  useEffect(() => {
    if (paused) return;
    try {
      const value = encode(docRef.current);
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== lastSaved.current) {
        setPaused(true);
        setRemote(stored);
        setError(
          "別の画面でキャンバスが変更されました。自動保存を一時停止しています。",
        );
        return;
      }
      localStorage.setItem(STORAGE_KEY, value);
      lastSaved.current = value;
      setSaveState("このブラウザに保存済み");
    } catch {
      setSaveState("自動保存できません");
      setError(
        "ブラウザに保存できませんでした。ファイルに保存して作業を残してください。",
      );
    }
  }, [history.past, history.future, paused]);
  useEffect(() => {
    const ids = new Set([
      ...doc.nodes.map((n) => n.id),
      ...doc.edges.map((e) => e.id),
    ]);
    setSelection((old) => old.filter((id) => ids.has(id)));
  }, [doc.nodes, doc.edges]);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 6500);
    return () => clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    document.title = (doc.title || "無題") + " — SimpleCanvas";
  }, [doc.title]);
  useEffect(() => {
    return watchStorage(
      STORAGE_KEY,
      () => lastSaved.current,
      (raw) => {
        setPaused(true);
        setRemote(raw);
        setError(
          "別の画面でキャンバスが変更されました。自動保存を一時停止しています。",
        );
      },
    );
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || help.current?.open) return;
      const command = e.metaKey || e.ctrlKey;
      if (command && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        actions.current.save();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "Escape") {
        clearPending();
        setTool("select");
        edit(null);
        select([]);
        menu.current?.removeAttribute("open");
        setDirty(false);
        return;
      }
      if (command) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? actions.current.redo() : actions.current.undo();
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          actions.current.redo();
        } else if (e.key.toLowerCase() === "d") {
          e.preventDefault();
          actions.current.duplicate();
        } else if (e.key.toLowerCase() === "a") {
          e.preventDefault();
          select(docRef.current.nodes.map((n) => n.id));
        } else if (e.key.toLowerCase() === "g") {
          e.preventDefault();
          actions.current.group();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        actions.current.remove();
      } else if (e.key.startsWith("Arrow") && selectionRef.current.length) {
        e.preventDefault();
        const step = e.shiftKey ? 32 : 8;
        commit(
          moveNodes(
            docRef.current,
            selectionRef.current,
            e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
            e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0,
          ),
        );
      } else if (
        e.key === "Enter" &&
        selectionRef.current.length === 1 &&
        docRef.current.nodes.some((n) => n.id === selectionRef.current[0])
      ) {
        e.preventDefault();
        edit(selectionRef.current[0]);
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        actions.current.add("box");
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        actions.current.add("note");
      } else if (e.key.toLowerCase() === "c") actions.current.connectMode();
      else if (e.key.toLowerCase() === "v") {
        setTool("select");
        clearPending();
      } else if (e.key.toLowerCase() === "h") {
        setTool("pan");
        clearPending();
      } else if (e.key === "1") actions.current.fit();
      else if (e.key === "?") help.current?.showModal();
    };
    const copy = (e: ClipboardEvent) => {
      if (
        isTyping(e.target) ||
        help.current?.open ||
        !selectionRef.current.length
      )
        return;
      const fragment = selectionDocument(docRef.current, selectionRef.current);
      if (!fragment.nodes.length) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", encode(fragment));
      if (e.type === "cut") actions.current.remove();
      else notify("選んだ要素をコピーしました。");
    };
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || help.current?.open) return;
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {}
        if (
          parsed &&
          typeof parsed === "object" &&
          "format" in parsed &&
          parsed.format === "simple-canvas"
        ) {
          const fragment = decode(text),
            b = bounds(fragment.nodes),
            center = canvas.current?.center() || { x: 0, y: 0 };
          const result = pasteDocument(docRef.current, fragment, {
            x: center.x - b.x - b.w / 2 + 24,
            y: center.y - b.y - b.h / 2 + 24,
          });
          commit(result.doc);
          select(result.ids);
          notify("貼り付けました。");
        } else {
          if (text.length > 6000)
            throw new Error("一つのメモは6000文字までです。");
          if (docRef.current.nodes.length >= MAX_NODES)
            throw new Error("要素は150個まで追加できます。");
          const next = clone(docRef.current),
            node = makeNode(
              "note",
              canvas.current?.center() || { x: 100, y: 100 },
            );
          node.body = text;
          next.nodes.push(node);
          commit(next);
          select([node.id]);
          notify("文章をメモとして貼り付けました。");
        }
      } catch (error) {
        setError(errorMessage(error));
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("copy", copy);
    window.addEventListener("cut", copy);
    window.addEventListener("paste", paste);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      // Blur commits the active native input or inline editor synchronously.
      // Write here too: a React effect is not guaranteed to run during unload.
      (document.activeElement as HTMLElement)?.blur?.();
      let canSave = !pausedRef.current;
      if (canSave) {
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (lastSaved.current !== null && stored !== lastSaved.current)
            throw new Error("The stored document changed in another tab.");
          const value = encode(docRef.current);
          localStorage.setItem(STORAGE_KEY, value);
          lastSaved.current = value;
        } catch {
          canSave = false;
        }
      }
      if (!canSave) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", copy);
      window.removeEventListener("paste", paste);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  const node =
    selection.length === 1
      ? doc.nodes.find((n) => n.id === selection[0])
      : undefined;
  const edge =
    selection.length === 1
      ? doc.edges.find((e) => e.id === selection[0])
      : undefined;
  return (
    <div className="app">
      <main className="workspace">
        <Canvas
          ref={canvas}
          doc={doc}
          selection={selection}
          tool={tool}
          pending={pending}
          editing={editing}
          draftId={draftNode?.id}
          getDocument={() => docRef.current}
          onSelect={select}
          onConnect={connect}
          onEdit={edit}
          onPatch={patchNode}
          onAddNote={(point) => add("note", point)}
          onAddConnected={(from, point) => {
            const source = docRef.current.nodes.find((n) => n.id === from);
            add(
              source?.kind === "note" ? "note" : "box",
              point,
              source?.kind === "box" ? source.shape : shape,
              from,
            );
          }}
          onPreview={(next) => {
            docRef.current = next;
            historyRef.current = historyReducer(historyRef.current, {
              type: "preview",
              next,
            });
            dispatch({ type: "preview", next });
            setDirty(true);
          }}
          onCommit={commit}
          selectionBar={
            inspectorOpen && (
              <SelectionBar
                doc={doc}
                node={node}
                edge={edge}
                count={selection.length}
                selection={selection}
                onColors={patchColors}
                onPatch={patchNode}
                onEdge={patchEdge}
                onDelete={remove}
                onDuplicate={duplicate}
                onGroup={group}
                onAttach={(id) => {
                  try {
                    flushInput();
                    const result = attachNote(docRef.current, id);
                    commit(result.doc);
                    select([result.id]);
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
                onFitGroup={(id) => commit(fitGroup(clone(docRef.current), id))}
                onSelect={select}
                onDirty={() => setDirty(true)}
              />
            )
          }
          onStatus={notify}
          onDirty={() => setDirty(true)}
        />
        <div className="floating doc-bar">
          <details
            className="file-menu"
            ref={menu}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button"))
                menu.current!.open = false;
            }}
          >
            <summary aria-label="メニュー" title="メニュー">
              <Icon name="menu" />
            </summary>
            <div className="file-popover">
              <button
                onClick={() => {
                  replace(emptyDocument());
                  notify("新しいキャンバスを開きました。元に戻せます。");
                }}
              >
                新しいキャンバス
              </button>
              <button onClick={() => file.current?.click()}>
                ファイルを開く…
              </button>
              <button onClick={save}>
                ファイルに保存 <kbd>⌘ S</kbd>
              </button>
              <hr />
              <button
                disabled={!doc.nodes.length}
                onClick={() => {
                  downloadFile(
                    toSvg(docRef.current),
                    filename(docRef.current.title) + ".svg",
                    "image/svg+xml",
                  );
                  notify("SVGを保存しました。");
                }}
              >
                SVGで保存
              </button>
              <button
                disabled={!doc.nodes.length || exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await exportPng(docRef.current);
                    notify("PNGを保存しました。");
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? "PNGに変換中…" : "PNGで保存"}
              </button>
              <hr />
              <button
                onClick={() => {
                  replace(growNodes(sampleDocument()));
                  notify("サンプルを開きました。前の内容へは元に戻せます。");
                }}
              >
                サンプルを開く
              </button>
              <hr />
              <button onClick={() => help.current?.showModal()}>
                使い方 <kbd>?</kbd>
              </button>
            </div>
          </details>
          <TextField
            className="document-title"
            label="キャンバス名"
            value={doc.title}
            onCommit={(title) =>
              commit({
                ...docRef.current,
                title: title.trim() || "無題のキャンバス",
              })
            }
            onDirty={() => setDirty(true)}
          />
          <span
            className={
              "save-status" +
              (paused || saveState === "自動保存できません" ? " unsaved" : "")
            }
          >
            <span className="save-long">{saveText}</span>
            {/* Narrow screens keep a short form instead of hiding the state. */}
            <span className="save-short" aria-hidden="true">
              {SHORT_SAVE_STATES[saveText] ?? saveText}
            </span>
          </span>
        </div>
        <div
          className="floating tool-rail"
          role="toolbar"
          aria-label="図の編集"
          aria-orientation="vertical"
        >
          <button
            className="icon-button rail-button"
            aria-label="選択ツール"
            data-tip="選択 V"
            aria-pressed={tool === "select"}
            onClick={() => {
              setTool("select");
              clearPending();
            }}
          >
            <Icon name="select" />
          </button>
          <button
            className="icon-button rail-button"
            aria-label="移動ツール"
            data-tip="キャンバスを移動 H"
            aria-pressed={tool === "pan"}
            onClick={() => {
              setTool("pan");
              clearPending();
            }}
          >
            <Icon name="pan" />
          </button>
          <span className="rail-divider" />
          {SHAPES.map((option) => (
            <button
              key={option}
              className="icon-button rail-button"
              aria-label={shapeLabels[option] + "を追加"}
              data-tip={shapeLabels[option] + (option === shape ? " B" : "")}
              onClick={() => {
                setShape(option);
                add("box", undefined, option);
              }}
            >
              <Icon name={shapeIcons[option]} />
            </button>
          ))}
          <span className="rail-divider" />
          <button
            className="icon-button rail-button"
            aria-label="メモを追加"
            data-tip="メモ N"
            onClick={() => add("note")}
          >
            <Icon name="note" />
          </button>
          <button
            className="icon-button rail-button"
            aria-label="接続"
            data-tip="接続 C"
            aria-pressed={tool === "connect"}
            onClick={connectMode}
          >
            <Icon name="connect" />
          </button>
          <button
            className="icon-button rail-button"
            aria-label="囲む"
            data-tip="選んだ要素を囲む ⌘G"
            onClick={group}
          >
            <Icon name="group" />
          </button>
          <button
            className="icon-button rail-button"
            aria-label="整頓"
            data-tip="線がまっすぐになるよう揃える"
            onClick={() => {
              try {
                flushInput();
                commit(arrange(docRef.current, selectionRef.current));
                notify("図形と線を整えました。");
              } catch (e) {
                notify(errorMessage(e));
              }
            }}
          >
            <Icon name="arrange" />
          </button>
        </div>
        <div className="floating history-bar">
          <button
            className="icon-button"
            aria-label="元に戻す"
            title="元に戻す (⌘ Z)"
            disabled={!history.past.length}
            onClick={undo}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            aria-label="やり直す"
            title="やり直す (⌘ Shift Z)"
            disabled={!history.future.length}
            onClick={redo}
          >
            <Icon name="redo" />
          </button>
        </div>
        {error && (
          <div className="notice" role="alert">
            <span>{error}</span>
            {recovery !== null && (
              <button
                onClick={() =>
                  downloadFile(
                    recovery,
                    "simplecanvas-recovery.txt",
                    "text/plain",
                  )
                }
              >
                元のデータを保存
              </button>
            )}
            {paused && remote !== null && (
              <span>
                開く前にこの画面の内容をファイルに保存できます。開くと編集履歴はリセットされます。
              </span>
            )}
            {paused && remote !== null && (
              <button
                onClick={() => {
                  try {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (!raw)
                      throw new Error(
                        "保存データが削除されています。この画面の内容をファイルに保存してください。",
                      );
                    const next = decode(raw);
                    replace(next);
                    const reset = { type: "reset" as const, next };
                    historyRef.current = historyReducer(
                      historyRef.current,
                      reset,
                    );
                    dispatch(reset);
                    lastSaved.current = raw;
                    setPaused(false);
                    setRemote(null);
                    setRecovery(null);
                    setError("");
                    requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(
                          'button[aria-label="全体を表示"]',
                        )
                        ?.focus(),
                    );
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                最新の内容を開く
              </button>
            )}
            {paused && (
              <button
                onClick={() => {
                  if (recovery)
                    downloadFile(
                      recovery,
                      "simplecanvas-recovery.txt",
                      "text/plain",
                    );
                  lastSaved.current = localStorage.getItem(STORAGE_KEY);
                  setRecovery(null);
                  setRemote(null);
                  setPaused(false);
                  setError("");
                }}
              >
                この画面の内容で保存を再開
              </button>
            )}
            {!paused && (
              <button
                className="icon-button"
                aria-label="通知を閉じる"
                onClick={() => setError("")}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        )}
        <div className="toast" role="status" aria-live="polite">
          {(status || pending) && (
            <span>
              {status || "接続先の図形を選んでください。Escで取り消せます。"}
            </span>
          )}
        </div>
      </main>
      <input
        ref={file}
        type="file"
        accept=".json,.simplecanvas,application/json"
        hidden
        onChange={async (e) => {
          const input = e.currentTarget,
            selected = input.files?.[0];
          if (!selected) return;
          try {
            if (selected.size > 2000000)
              throw new Error("ファイルの上限は2MBです。");
            replace(decode(await selected.text()));
            notify("ファイルを開きました。読み込み前の内容へも元に戻せます。");
          } catch (error) {
            setError(
              "読み込めませんでした：" +
                errorMessage(error) +
                " 現在の内容は保持しています。",
            );
          } finally {
            input.value = "";
          }
        }}
      />
      <dialog
        ref={help}
        className="help-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) help.current?.close();
        }}
      >
        <div className="dialog-heading">
          <h2>使い方</h2>
          <button
            className="icon-button"
            aria-label="使い方を閉じる"
            onClick={() => help.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <p>
          上部の図形アイコンから、箱・楕円・ひし形・円柱を選べます。名前や説明を入力せずに閉じると、図形は追加されません。
        </p>
        <p>
          変更はこのブラウザに自動保存されます。別の端末で編集する場合は「ファイルに保存」を使ってください。
        </p>
        <dl>
          {[
            ["図形 / メモを追加", "B / N"],
            ["図形の文字を編集", "ダブルクリック / 選択して Enter"],
            ["メモ・囲みを編集", "ダブルクリック / 選択して Enter"],
            ["編集を確定 / 取り消し", "⌘ Enter / Esc"],
            ["接続元と接続先を選ぶ", "C（接続点のドラッグも可）"],
            ["接続した図形を追加", "接続点を空いた場所へドラッグ"],
            ["複数選択", "Shift＋クリック / 余白をドラッグ"],
            ["囲む", "⌘ G"],
            ["選択した要素を移動", "矢印キー / Shiftで大きく移動"],
            ["複製 / コピー / 貼り付け", "⌘ D / ⌘ C / ⌘ V"],
            ["キャンバスを移動", "2本指スクロール / Space＋ドラッグ"],
            ["拡大・縮小", "ピンチ / Ctrl＋ホイール"],
            ["全体を表示", "1"],
            ["元に戻す / やり直す", "⌘ Z / ⌘ Shift Z"],
            ["編集できるファイルを保存", "⌘ S"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="field-help">
          Windowsでは⌘の代わりにCtrlを使います。囲みを消しても中の要素は残ります。図形を消すと接続線も消えます。図に置いたメモは残ります。
        </p>
        <button className="primary" onClick={() => help.current?.close()}>
          閉じる
        </button>
      </dialog>
    </div>
  );
}
