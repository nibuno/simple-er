import { erCatalog } from "../../shared/diagram-catalog.ts";
import {
  clearLinkedUrl,
  linkedUrl,
  storageScope,
} from "../../shared/diagram-links.ts";
import {
  useDiagramLinks,
  MissingDiagram,
} from "../../shared/useDiagramLinks.tsx";
import { isImeKey } from "../../shared/ime.ts";
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
  MAX_TEXT,
  moveNodes,
  pasteDocument,
  placeInFreeSpace,
  removeSelection,
  sampleDocument,
  selectionDocument,
  uid,
} from "./model";
import { looksLikeFlowchart, parseFlowchart, toFlowchart } from "./flowchart";
import { copyImage, downloadFile, exportPng, filename, toSvg } from "./export";
import { viewerHtml } from "./html";
import { Canvas } from "./Canvas";
import { DiagramList } from "../../shared/DiagramList.tsx";
import { TextField } from "../../shared/TextField.tsx";
import { MemoList } from "./MemoList";
import { VariantComparison, type VariantPair } from "./VariantComparison";
import {
  groupVariants,
  isChoiceKey,
  createVariant,
  chooseVariant,
  clearVariantChoice,
} from "./variants";
import {
  checkDiagram,
  DiagramChanged,
  library,
  newDiagramKey,
  openDiagram,
  rememberDiagram,
  viewKeyFor,
  writeDiagram,
} from "./library";
import type { DiagramEntry, OpenDiagram } from "./library";
import type { CanvasHandle } from "./Canvas";
import { SelectionBar } from "./Inspector";
import type { Panel } from "./Inspector";
import { Icon } from "./Icons";
import { RAIL_SHAPES, SHAPES, shapeIcons, shapeLabels } from "./shapes";

const isTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest("input,textarea,select,[contenteditable='true']");
const keepNativeKeys = (target: EventTarget | null) =>
  isTyping(target) ||
  (target instanceof Element && !!target.closest(".memo-list,.file-menu"));
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const SHORT_SAVE_STATES: Record<string, string> = {
  自動保存を停止中: "保存停止中",
  自動保存できません: "保存できません",
};
export function App() {
  const [session, setSession] = useState(() => ({
    initial: library.restoreLinkedDiagram(),
    visit: 0,
    message: "",
  }));
  if (!session.initial) return <MissingDiagram app="SimpleCanvas" />;
  return (
    <Editor
      key={session.visit}
      initial={session.initial}
      message={session.message}
      onOpen={(initial, message = "") => {
        clearLinkedUrl();
        setSession((old) => ({ initial, message, visit: old.visit + 1 }));
      }}
    />
  );
}

function Editor({
  initial,
  message,
  onOpen,
}: {
  initial: OpenDiagram;
  message: string;
  onOpen: (next: OpenDiagram, message?: string) => void;
}) {
  const [history, dispatch] = useReducer(historyReducer, {
    present: initial.doc,
    past: [],
    future: [],
  });
  // Only the first editing session can amend the step that placed this box.
  const newBox = useRef<string | null>(null);
  const [savePoint, setSavePoint] = useState(0);
  const erDiagrams = useDiagramLinks(erCatalog);
  const sharedSite = /\/canvas\/(?:index\.html)?$/.test(
    window.location.pathname,
  );
  function erTarget(node: CanvasNode) {
    const link = node.erLink;
    return sharedSite && link && link.store === erDiagrams.store
      ? erDiagrams.entries.find(
          (entry) => entry.key === link.key && entry.id === link.id,
        )
      : undefined;
  }
  const [draftNode, setDraftNode] = useState<CanvasNode | null>(null),
    draftRef = useRef<CanvasNode | null>(null);
  // Empty text has no visible face. Keep it and its optional line in a draft.
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
    [placing, setPlacing] = useState<{
      kind: "box" | "note";
      shape: NodeShape;
    } | null>(null),
    [shape, setShape] = useState<NodeShape>("rectangle"),
    [pending, setPending] = useState<string | null>(null),
    pendingRef = useRef<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null),
    [status, setStatus] = useState(message),
    [error, setError] = useState(initial.error ?? "");
  const [listOpen, setListOpen] = useState<"diagrams" | "memos" | null>(null);
  const [comparison, setComparison] = useState<VariantPair | null>(null);
  const [moreShapes, setMoreShapes] = useState(false);
  useEffect(() => {
    if (!moreShapes) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? !isImeKey(e) && e.key === "Escape"
          : !(e.target as Element).closest?.(".rail-more")
      )
        setMoreShapes(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [moreShapes]);
  const [barRequest, setBarRequest] = useState<{
    id: string;
    panel: Panel;
  } | null>(null);
  const [saveProblem, setSaveProblem] = useState(""),
    [paused, setPaused] = useState(!!initial.error);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [recovery, setRecovery] = useState(initial.error ? initial.raw : null),
    [remote, setRemote] = useState<string | null>(null),
    [exporting, setExporting] = useState<
      "png" | "image" | "markdown" | "html" | null
    >(null);
  const saveWarning = paused
    ? "自動保存を停止中"
    : saveProblem
      ? "自動保存できません"
      : "";
  const canvas = useRef<CanvasHandle>(null),
    file = useRef<HTMLInputElement>(null),
    menu = useRef<HTMLDetailsElement>(null),
    pasteDialog = useRef<HTMLDialogElement>(null),
    help = useRef<HTMLDialogElement>(null);
  const [pasteInput, setPasteInput] = useState("");
  const [pasteError, setPasteError] = useState("");
  const lastSaved = useRef(initial),
    actions = useRef({
      pasteText: (_text: string): boolean => false,
      undo: () => {},
      redo: () => {},
      addAtPointer: (_kind: "box" | "note") => {},
      duplicate: () => {},
      remove: () => {},
      group: () => {},
      save: () => {},
      copyImage: () => {},
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
    if (id) {
      selectionRef.current = selectionRef.current.filter(
        (selected) => selected !== id,
      );
      setSelection(selectionRef.current);
    }
  }
  // Any other tool ends placing.
  function chooseTool(next: Tool | ((old: Tool) => Tool)) {
    setPlacing(null);
    setTool(next);
  }
  function select(ids: string[]) {
    flushInput();
    setBarRequest(null);
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
  function commit(
    next: CanvasDocument,
    before?: CanvasDocument,
    amend = false,
  ) {
    try {
      growNodes(next);
      // Validate edits as well as imports, so every saved document is reloadable.
      const valid = decode(encode(next));
      docRef.current = valid;
      const action = amend
        ? { type: "amend" as const, next: valid }
        : { type: "commit" as const, next: valid, before };
      newBox.current = null;
      if (amend) setSavePoint((point) => point + 1);
      historyRef.current = historyReducer(historyRef.current, action);
      dispatch(action);
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
    commit(next, undefined, newBox.current === id);
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
    if (id !== newBox.current) newBox.current = null;
    setEditing(id);
    if (id) select([id]);
  }
  function add(
    kind: "box" | "note",
    point?: Point,
    nodeShape = shape,
    from?: string,
    place = false,
    centerOn = false,
  ) {
    flushInput();
    discardDraft();
    const next = clone(docRef.current);
    if (next.nodes.length >= MAX_NODES) {
      setError("追加できるのは150個までです");
      return;
    }
    if (from && next.edges.length >= MAX_EDGES) {
      setError("線は400本までです");
      return;
    }
    const center = point || canvas.current?.center() || { x: 100, y: 100 },
      node = makeNode(kind, center, nodeShape);
    // A dropped line, and a figure the pointer put down, sit centered on
    // their point.
    if (!point || from || centerOn) {
      node.x = Math.round((node.x - node.w / 2) / 8) * 8;
      node.y = Math.round((node.y - node.h / 2) / 8) * 8;
    }
    if (!point || place) placeInFreeSpace(node, next);
    const edge = from
      ? { id: uid(), from, to: node.id, label: "", dashed: false }
      : null;
    if (kind === "box") {
      next.nodes.push(node);
      if (edge) next.edges.push(edge);
      if (!commit(next)) return;
      newBox.current = node.id;
    } else {
      setDraft(node, edge);
    }
    clearPending();
    chooseTool("select");
    select([node.id]);
    setEditing(node.id);
  }
  function startPlacing(kind: "box" | "note", nodeShape = shape) {
    flushInput();
    discardDraft();
    clearPending();
    setTool("place");
    setPlacing({ kind, shape: nodeShape });
    notify("置きたい場所をクリック（Escでやめる）");
  }
  function connect(id: string, fromOverride?: string) {
    flushInput();
    if (docRef.current.nodes.find((n) => n.id === id)?.kind === "group") {
      notify("図形かテキストを選択してください");
      return;
    }
    const from = fromOverride ?? pendingRef.current;
    if (!from) {
      pendingRef.current = id;
      setPending(id);
      select([id]);
      notify("接続先を選択（Escでやめる）");
      return;
    }
    if (from === id) {
      clearPending();
      notify("接続をやめました");
      return;
    }
    if (docRef.current.edges.some((e) => e.from === from && e.to === id)) {
      clearPending();
      notify("同じ向きの線がすでにあります");
      return;
    }
    if (docRef.current.edges.length >= MAX_EDGES) {
      setError("線は400本までです");
      clearPending();
      return;
    }
    const next = clone(docRef.current),
      edge = { id: uid(), from, to: id, label: "", dashed: false };
    next.edges.push(edge);
    commit(next);
    clearPending();
    chooseTool("select");
    select([edge.id]);
    notify("接続しました");
  }
  function remove() {
    flushInput();
    if (!selectionRef.current.length) return;
    commit(removeSelection(docRef.current, selectionRef.current));
    select([]);
    edit(null);
    clearPending();
    notify("削除しました");
  }
  function pasteText(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const isCanvas =
      parsed &&
      typeof parsed === "object" &&
      "format" in parsed &&
      parsed.format === "simple-canvas";
    if (
      !isCanvas &&
      text.length > MAX_TEXT &&
      !/^\s*(?:flowchart|graph)\b/i.test(text)
    )
      throw new Error(`テキストは${MAX_TEXT}文字までです`);
    if (!isCanvas && text.length > 2_000_000)
      throw new Error("Mermaidの上限は200万文字です");
    if (isCanvas || looksLikeFlowchart(text)) {
      const fragment = isCanvas ? decode(text) : parseFlowchart(text);
      const area = bounds(fragment.nodes);
      const center = canvas.current?.center() || { x: 0, y: 0 };
      const target = {
        ...area,
        x: center.x - area.w / 2 + 24,
        y: center.y - area.h / 2 + 24,
      };
      if (!isCanvas) placeInFreeSpace(target, docRef.current);
      const result = pasteDocument(docRef.current, fragment, {
        x: target.x - area.x,
        y: target.y - area.y,
      });
      if (!commit(result.doc)) return false;
      select(result.ids);
      if (!isCanvas) canvas.current?.centerOn(target);
      notify(isCanvas ? "貼り付けました" : "図にしました");
    } else {
      if (docRef.current.nodes.length >= MAX_NODES)
        throw new Error("追加できるのは150個までです");
      const next = clone(docRef.current),
        node = makeNode("note", canvas.current?.center() || { x: 100, y: 100 });
      node.body = text;
      next.nodes.push(node);
      if (!commit(next)) return false;
      select([node.id]);
      notify("テキストとして貼り付けました");
    }
    return true;
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
      notify("複製しました");
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
      canvas.current?.reveal();
      notify("囲みました");
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
    clearPending();
    notify("元に戻しました");
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
    clearPending();
    notify("やり直しました");
  }
  function save() {
    flushInput();
    downloadFile(
      encode(docRef.current),
      filename(docRef.current.title) + ".simplecanvas.json",
    );
    notify("ファイルに保存しました");
  }
  async function exportDiagram(format: "png" | "image" | "markdown" | "html") {
    flushInput();
    const current = docRef.current;
    if (!current.nodes.length || exporting) return;
    const computed = canvas.current?.routesFor(current);
    setExporting(format);
    try {
      if (format === "png") {
        await exportPng(current, computed);
        notify("PNGで保存しました");
      } else if (format === "image") {
        await copyImage(current, selectionRef.current, computed);
        notify("画像をコピーしました");
      } else if (format === "html") {
        const { default: template } = await import("./viewer.html?raw");
        downloadFile(
          viewerHtml(current, template, computed),
          filename(current.title) + ".html",
          "text/html;charset=utf-8",
        );
        notify("閲覧用HTMLを保存しました");
      } else {
        const { markdownArchive } = await import("./markdown");
        downloadFile(
          markdownArchive(current, computed),
          filename(current.title) + ".zip",
        );
        notify("Markdownと図を保存しました");
      }
    } catch (e) {
      setError(
        format === "image"
          ? "画像をコピーできません。メニューの「PNGで保存」を使ってください。"
          : errorMessage(e),
      );
    } finally {
      setExporting(null);
    }
  }
  async function exportMermaid(action: "copy" | "save") {
    flushInput();
    const current = docRef.current;
    const text = toFlowchart(current);
    if (action === "save") {
      downloadFile(
        text,
        filename(current.title) + ".mmd",
        "text/plain;charset=utf-8",
      );
      notify("Mermaidで保存しました");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify("Mermaidでコピーしました");
    } catch {
      setError(
        "コピーできません。メニューの「Mermaidで保存」を使ってください。",
      );
    }
  }
  function pause(raw: string | null) {
    pausedRef.current = true;
    setPaused(true);
    setSaveProblem("");
    setRemote(raw);
    setError(new DiagramChanged(raw).message + "自動保存を止めています。");
  }
  function persist(overwrite = false) {
    if (pausedRef.current && !overwrite)
      throw new Error("図を切り替える前に、自動保存を再開してください。");
    const saved = lastSaved.current,
      current = docRef.current;
    try {
      if (
        !overwrite &&
        saved.raw !== null &&
        (current === saved.doc || encode(current) === encode(saved.doc))
      ) {
        checkDiagram(initial.key, saved.raw);
      } else {
        const expected = overwrite
          ? localStorage.getItem(initial.key)
          : saved.raw;
        lastSaved.current = writeDiagram(initial.key, current, expected);
      }
      setSaveProblem("");
    } catch (e) {
      if (e instanceof DiagramChanged) pause(e.raw);
      else setSaveProblem(errorMessage(e));
      throw e;
    }
  }
  function resumeSave() {
    if (recovery !== null)
      downloadFile(recovery, "simplecanvas-recovery.txt", "text/plain");
    persist(true);
    pausedRef.current = false;
    setPaused(false);
    setRecovery(null);
    setRemote(null);
    setError("");
  }
  function saveCopy() {
    flushInput();
    const doc = { ...docRef.current, id: uid() };
    onOpen(
      writeDiagram(newDiagramKey(), doc, null),
      "別の図として保存しました",
    );
  }
  function retrySave() {
    try {
      persist();
    } catch {
      /* persist reports the reason in the editor. */
    }
  }
  function saveBeforeSwitch() {
    flushInput();
    if (
      pausedRef.current &&
      encode(docRef.current) === encode(lastSaved.current.doc)
    )
      return;
    persist();
  }
  function openEr(node: CanvasNode) {
    const link = node.erLink;
    if (!link || !erTarget(node)) {
      select([node.id]);
      setBarRequest({ id: node.id, panel: "er" });
      return;
    }
    runMenu(() => {
      saveBeforeSwitch();
      window.location.assign(linkedUrl("er", link));
    });
  }
  function createDiagram(doc: CanvasDocument, message: string) {
    saveBeforeSwitch();
    onOpen(writeDiagram(newDiagramKey(), decode(encode(doc)), null), message);
  }
  function makeVariant(source?: DiagramEntry) {
    saveBeforeSwitch();
    const groups = groupVariants(library.listDiagrams());
    const sourceKey = source?.key ?? initial.key;
    const group = groups.find((g) => g.some((e) => e.key === sourceKey));
    const entry = group?.find((e) => e.key === sourceKey);
    if (!group || !entry)
      throw new Error("元の図を保存してから案を作ってください。");
    if (source && source.key !== initial.key)
      checkDiagram(source.key, source.raw);
    if (sourceKey === initial.key && pausedRef.current)
      throw new Error("自動保存を再開してから案を作ってください。");
    const names = new Set(group.map((e) => e.title));
    let number = 1;
    while (names.has("案" + number)) number++;
    onOpen(createVariant(entry, "案" + number), "案を作りました");
  }
  function newCanvas() {
    createDiagram(emptyDocument(), "新しいキャンバスを作成しました");
  }
  function runMenu(action: () => void) {
    try {
      action();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function showList() {
    flushInput();
    if (!pausedRef.current) retrySave();
    setListOpen("diagrams");
  }
  function closeList() {
    setListOpen(null);
    requestAnimationFrame(() =>
      menu.current?.querySelector("summary")?.focus(),
    );
  }
  function renameDiagram(entry: DiagramEntry, title: string) {
    const active = entry.key === initial.key;
    const source = active
      ? lastSaved.current
      : openDiagram(entry.key, entry.raw);
    if (source.error || (active && pausedRef.current))
      throw new Error("図を開いて保存データを確認してください。");
    const current = active ? docRef.current : source.doc;
    if (current.title === title) return;
    const doc = decode(encode({ ...current, title }));
    const next = writeDiagram(entry.key, doc, entry.raw);
    if (active) {
      lastSaved.current = next;
      commit(doc);
    }
  }
  function deleteDiagram(entry: DiagramEntry) {
    const next = library.deleteDiagram(entry, initial.key);
    clearVariantChoice(entry.key);
    if (next) onOpen(next, "図を削除しました");
    else {
      if (!pausedRef.current) setError("");
      if (saveProblem) retrySave();
    }
  }
  function connectMode() {
    flushInput();
    clearPending();
    chooseTool((old) => (old === "connect" ? "select" : "connect"));
    notify("接続元を選択");
  }
  actions.current = {
    pasteText,
    undo,
    redo,
    addAtPointer(kind) {
      const point = canvas.current?.pointerPoint();
      if (point) add(kind, point, shape, undefined, false, true);
      else startPlacing(kind);
    },
    duplicate,
    remove,
    group,
    save,
    copyImage: () => exportDiagram("image"),
    connectMode,
    fit: () => canvas.current?.fit(),
  };
  useEffect(() => {
    if (!paused) retrySave();
  }, [history.past, history.future, savePoint, paused]);
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
    rememberDiagram(initial.key);
    return watchStorage(initial.key, () => lastSaved.current.raw, pause);
  }, []);
  useEffect(() => {
    const dialogOpen = () => !!document.querySelector("dialog[open]");
    const key = (e: KeyboardEvent) => {
      if (isImeKey(e) || dialogOpen()) return;
      const command = e.metaKey || e.ctrlKey;
      if (command && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        actions.current.save();
        return;
      }
      if (keepNativeKeys(e.target)) return;
      if (e.key === "Escape") {
        clearPending();
        chooseTool("select");
        edit(null);
        select([]);
        menu.current?.removeAttribute("open");
        return;
      }
      if (command) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? actions.current.redo() : actions.current.undo();
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          actions.current.redo();
        } else if (e.shiftKey && e.key.toLowerCase() === "c") {
          e.preventDefault();
          actions.current.copyImage();
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
        !(
          e.target instanceof Element &&
          e.target.closest(".selection-bar button, .er-marker")
        ) &&
        selectionRef.current.length === 1 &&
        docRef.current.nodes.some((n) => n.id === selectionRef.current[0])
      ) {
        e.preventDefault();
        edit(selectionRef.current[0]);
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        actions.current.addAtPointer("box");
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        actions.current.addAtPointer("note");
      } else if (e.key.toLowerCase() === "c") actions.current.connectMode();
      else if (e.key.toLowerCase() === "v") {
        chooseTool("select");
        clearPending();
      } else if (e.key.toLowerCase() === "h") {
        chooseTool("pan");
        clearPending();
      } else if (e.key === "1") actions.current.fit();
      else if (e.key === "?") help.current?.showModal();
    };
    const copy = (e: ClipboardEvent) => {
      if (
        keepNativeKeys(e.target) ||
        dialogOpen() ||
        !selectionRef.current.length
      )
        return;
      const fragment = selectionDocument(docRef.current, selectionRef.current);
      if (!fragment.nodes.length) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", encode(fragment));
      if (e.type === "cut") actions.current.remove();
      else notify("コピーしました");
    };
    const paste = (e: ClipboardEvent) => {
      if (keepNativeKeys(e.target) || dialogOpen()) return;
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      try {
        actions.current.pasteText(text);
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
      try {
        persist();
      } catch {
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
  const canExportMermaid = doc.nodes.some((n) => n.kind === "box");
  const node =
    selection.length === 1
      ? doc.nodes.find((n) => n.id === selection[0])
      : undefined;
  const edge =
    selection.length === 1
      ? doc.edges.find((e) => e.id === selection[0])
      : undefined;
  const shapeButton = (option: NodeShape) => (
    <button
      key={option}
      data-rail-shortcut={RAIL_SHAPES.includes(option) || undefined}
      className="icon-button rail-button"
      aria-label={shapeLabels[option] + "を追加"}
      aria-pressed={placing?.kind === "box" && placing.shape === option}
      data-tip={shapeLabels[option] + (option === shape ? " B" : "")}
      onClick={() => {
        setShape(option);
        setMoreShapes(false);
        startPlacing("box", option);
      }}
    >
      <Icon name={shapeIcons[option]} />
    </button>
  );
  return (
    <div className="app">
      <main className="workspace">
        <Canvas
          ref={canvas}
          doc={doc}
          viewKey={viewKeyFor(initial.key)}
          selection={selection}
          tool={tool}
          pending={pending}
          editing={editing}
          addedId={draftNode?.id ?? newBox.current}
          getDocument={() => docRef.current}
          onSelect={select}
          onConnect={connect}
          onEdit={edit}
          onPatch={patchNode}
          onAddNote={(point) => add("note", point)}
          onPlace={(point) => {
            if (!placing) return;
            chooseTool("select");
            add(placing.kind, point, placing.shape, undefined, false, true);
          }}
          onEditEdge={(id) => {
            select([id]);
            setBarRequest({ id, panel: "label" });
          }}
          onAddConnected={(from, point, place) => {
            const source = docRef.current.nodes.find((n) => n.id === from);
            add(
              source?.kind === "note" ? "note" : "box",
              point,
              source?.kind === "box" ? source.shape : shape,
              from,
              place,
            );
          }}
          onPreview={(next) => {
            docRef.current = next;
            historyRef.current = historyReducer(historyRef.current, {
              type: "preview",
              next,
            });
            dispatch({ type: "preview", next });
          }}
          onCommit={commit}
          erTitle={(node) => erTarget(node)?.title}
          onOpenEr={openEr}
          selectionBar={
            <SelectionBar
              flushInput={flushInput}
              doc={doc}
              node={node}
              edge={edge}
              count={selection.length}
              selection={selection}
              sharedSite={sharedSite}
              erEntries={erDiagrams.entries}
              selectedEr={node && erTarget(node)?.key}
              onOpenEr={openEr}
              onLinkEr={(key) =>
                runMenu(() => {
                  if (!node) return;
                  const entry = erDiagrams.entries.find(
                    (entry) => entry.key === key,
                  );
                  if (!entry) {
                    patchNode(node.id, { erLink: undefined });
                    return;
                  }
                  let store;
                  try {
                    store = storageScope(true)!;
                  } catch {
                    throw new Error(
                      "リンクを保存できません。ブラウザの空き容量を確認してください。",
                    );
                  }
                  patchNode(node.id, { erLink: { store, key, id: entry.id } });
                  if (store !== erDiagrams.store) erDiagrams.refresh();
                })
              }
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
                  canvas.current?.reveal();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
              onFitGroup={(id) => commit(fitGroup(clone(docRef.current), id))}
              onSelect={select}
              request={barRequest}
            />
          }
          onStatus={notify}
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
              <button onClick={showList}>図の一覧</button>
              <button
                disabled={paused}
                onClick={() => runMenu(() => makeVariant())}
              >
                案を作る
              </button>
              <button
                aria-expanded={listOpen === "memos"}
                onClick={() => {
                  flushInput();
                  if (listOpen === "memos") closeList();
                  else setListOpen("memos");
                }}
              >
                メモの一覧
              </button>
              <button onClick={() => runMenu(newCanvas)}>
                新しいキャンバス
              </button>
              <button onClick={() => file.current?.click()}>
                ファイルを開く…
              </button>
              <button
                onClick={() => {
                  setPasteInput("");
                  setPasteError("");
                  pasteDialog.current?.showModal();
                  pasteDialog.current?.querySelector("textarea")?.focus();
                }}
              >
                テキストを貼り付け…
              </button>
              <button onClick={save}>
                ファイルに保存 <kbd>⌘ S</kbd>
              </button>
              <hr />
              <button
                disabled={!doc.nodes.length}
                onClick={() => {
                  downloadFile(
                    toSvg(
                      docRef.current,
                      [],
                      canvas.current?.routesFor(docRef.current),
                    ),
                    filename(docRef.current.title) + ".svg",
                    "image/svg+xml",
                  );
                  notify("SVGで保存しました");
                }}
              >
                SVGで保存
              </button>
              <button
                disabled={!doc.nodes.length || !!exporting}
                onClick={() => exportDiagram("png")}
              >
                {exporting === "png" ? "PNGに変換中…" : "PNGで保存"}
              </button>
              <button
                disabled={!doc.nodes.length || !!exporting}
                onClick={() => exportDiagram("image")}
              >
                画像をコピー <kbd>⌘⇧C</kbd>
              </button>
              <button
                disabled={!doc.nodes.length || !!exporting}
                onClick={() => exportDiagram("markdown")}
              >
                Markdownで保存（図付き）
              </button>
              <button
                disabled={!doc.nodes.length || !!exporting}
                onClick={() => exportDiagram("html")}
              >
                閲覧用HTMLで保存
              </button>
              <button
                disabled={!canExportMermaid}
                onClick={() => exportMermaid("copy")}
              >
                Mermaidでコピー
              </button>
              <button
                disabled={!canExportMermaid}
                onClick={() => exportMermaid("save")}
              >
                Mermaidで保存
              </button>
              <hr />
              <button
                onClick={() =>
                  runMenu(() =>
                    createDiagram(
                      growNodes(sampleDocument()),
                      "サンプルを開きました",
                    ),
                  )
                }
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
            cancelOnEscape
            emptyValue="無題のキャンバス"
            value={doc.title}
            onCommit={(title) =>
              commit({
                ...docRef.current,
                title,
              })
            }
          />
          {saveWarning && (
            <span className="save-status">
              <span className="save-long">{saveWarning}</span>
              {/* Narrow screens keep a short form instead of hiding it. */}
              <span className="save-short" aria-hidden="true">
                {SHORT_SAVE_STATES[saveWarning] ?? saveWarning}
              </span>
            </span>
          )}
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
              chooseTool("select");
              clearPending();
            }}
          >
            <Icon name="select" />
          </button>
          <button
            className="icon-button rail-button"
            aria-label="移動ツール"
            data-tip="手のひら H"
            aria-pressed={tool === "pan"}
            onClick={() => {
              chooseTool("pan");
              clearPending();
            }}
          >
            <Icon name="pan" />
          </button>
          <span className="rail-divider" />
          <span className="rail-anchor">
            {shapeButton(RAIL_SHAPES[0])}
            {!doc.nodes.length && !placing && (
              <span className="rail-hint">← ここから図形を置きます</span>
            )}
          </span>
          {RAIL_SHAPES.slice(1).map(shapeButton)}
          <div className="rail-more">
            <button
              className="icon-button rail-button"
              aria-label="その他の図形"
              data-tip="その他の図形"
              aria-expanded={moreShapes}
              onClick={() => setMoreShapes(!moreShapes)}
            >
              <Icon name="shapes" />
            </button>
            {moreShapes && (
              <div
                className="rail-popover"
                role="group"
                aria-label="その他の図形"
              >
                {SHAPES.filter((option) => option !== RAIL_SHAPES[0]).map(
                  shapeButton,
                )}
              </div>
            )}
          </div>
          <span className="rail-divider" />
          <button
            className="icon-button rail-button"
            aria-label="テキストを追加"
            aria-pressed={placing?.kind === "note"}
            data-tip="テキスト N"
            onClick={() => startPlacing("note")}
          >
            <Icon name="text" />
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
            data-tip="囲む ⌘G"
            onClick={group}
          >
            <Icon name="group" />
          </button>
          <button
            className="icon-button rail-button"
            aria-label="整頓"
            data-tip="整頓"
            onClick={() => {
              try {
                flushInput();
                const before = docRef.current,
                  next = arrange(before, selectionRef.current),
                  moved = next.nodes.filter((n) => {
                    const old = before.nodes.find((o) => o.id === n.id);
                    return old && (old.x !== n.x || old.y !== n.y);
                  }).length;
                // Say what changed: the moves are often only a few pixels.
                if (!moved) {
                  notify("整頓する図形はありません");
                  return;
                }
                commit(next);
                notify(moved + "個の図形を整頓しました");
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
        {(error || saveProblem) && (
          <div className="notice" role="alert">
            <span>
              {saveProblem || error}
              {paused &&
                remote !== null &&
                " 最新の内容を開くと、この画面の編集と履歴が消えます。"}
            </span>
            {(saveProblem || paused) && (
              <>
                <button onClick={save}>ファイルに保存</button>
                <button onClick={showList}>図の一覧</button>
                {!paused && <button onClick={retrySave}>保存を再試行</button>}
              </>
            )}
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
              <button
                onClick={() => {
                  try {
                    const next = openDiagram(initial.key);
                    if (next.error) throw new Error(next.error);
                    onOpen(next);
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
              <button onClick={() => runMenu(resumeSave)}>
                この画面の内容で保存を再開
              </button>
            )}
            {!paused && !saveProblem && (
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
            <span>{status || "接続先を選択（Escでやめる）"}</span>
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
            const doc = decode(await selected.text());
            if (input.isConnected)
              runMenu(() => createDiagram(doc, "ファイルを開きました"));
          } catch (error) {
            setError(
              "読み込めませんでした：" +
                errorMessage(error) +
                "（今の図はそのままです）",
            );
          } finally {
            input.value = "";
          }
        }}
      />
      {listOpen === "memos" && (
        <MemoList
          doc={doc}
          selectedId={node?.attachedTo || node?.id}
          onClose={closeList}
          onSelect={(owner) => {
            clearPending();
            chooseTool("select");
            select([owner.id]);
            canvas.current?.centerOn(owner);
          }}
        />
      )}
      {comparison && (
        <VariantComparison
          pair={comparison}
          onClose={() => setComparison(null)}
          onChoose={(primary, selected, other) => {
            saveBeforeSwitch();
            checkDiagram(other.key, other.raw);
            onOpen(chooseVariant(primary, selected), "元の図にしました");
          }}
        />
      )}
      {listOpen === "diagrams" && !comparison && (
        <DiagramList
          library={library}
          Icon={Icon}
          variants={{
            group: groupVariants,
            isChoiceKey,
            create: makeVariant,
            compare: (group, entry) => {
              const current = group
                .slice(1)
                .find((item) => item.key === initial.key);
              const right = entry === group[0] ? (current ?? group[1]) : entry;
              setComparison({ group, rightKey: right.key });
            },
          }}
          emptyName="空のキャンバス"
          activeKey={initial.key}
          paused={
            paused && !initial.error
              ? {
                  title: doc.title || "無題のキャンバス",
                  saveCopy,
                  resume: resumeSave,
                }
              : undefined
          }
          onClose={closeList}
          onCreate={newCanvas}
          onOpen={(entry) => {
            if (entry.key === initial.key) return closeList();
            saveBeforeSwitch();
            onOpen(openDiagram(entry.key));
          }}
          onDuplicate={(entry) => {
            const active = entry.key === initial.key;
            const source = active ? lastSaved.current : openDiagram(entry.key);
            if (source.error) throw new Error(source.error);
            const doc = active ? docRef.current : source.doc;
            const title =
              (doc.title || "無題のキャンバス").slice(0, 196) + "のコピー";
            createDiagram({ ...doc, id: uid(), title }, "図を複製しました");
          }}
          onRename={renameDiagram}
          onDelete={deleteDiagram}
        />
      )}
      <dialog
        ref={pasteDialog}
        className="help-dialog paste-dialog"
        aria-labelledby="paste-heading"
        onClose={() => menu.current?.querySelector("summary")?.focus()}
      >
        <div className="dialog-heading">
          <h2 id="paste-heading">テキストを貼り付け</h2>
          <button
            className="icon-button"
            aria-label="閉じる"
            onClick={() => pasteDialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <label>
          テキストまたは Mermaid
          <textarea
            rows={6}
            value={pasteInput}
            onChange={(e) => {
              setPasteInput(e.target.value);
              setPasteError("");
            }}
          />
        </label>
        {pasteError && <p role="alert">{pasteError}</p>}
        <button
          className="primary"
          disabled={!pasteInput.trim()}
          onClick={() => {
            try {
              if (pasteText(pasteInput)) pasteDialog.current?.close();
              else setPasteError("貼り付けられませんでした");
            } catch (error) {
              setPasteError(errorMessage(error));
            }
          }}
        >
          貼り付け
        </button>
      </dialog>
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
          左のツール列から図形を置き、矢印で次の図形につなげます。図の横には理由をテキストで書き添えられます。
        </p>
        <p>
          変更はこのブラウザに自動保存されます。メニューの「図の一覧」からほかの図を開けます。ほかの端末で使うときは「ファイルに保存」してください。
        </p>
        <dl>
          {[
            ["図形 / テキストを追加", "B / N（カーソルの位置に出ます）"],
            ["ツールバーから追加", "置きたい場所をクリック"],
            ["文字を編集", "ダブルクリック / Enter"],
            ["編集を確定", "Esc / ⌘ Enter"],
            ["線のラベル", "線をダブルクリック"],
            ["接続", "C / 矢印をドラッグ"],
            ["つながった図形を追加", "矢印をクリック"],
            ["複数選択", "Shift＋クリック / 余白をドラッグ"],
            ["囲む", "⌘ G"],
            ["選択中のものを移動", "矢印キー（Shiftで大きく）"],
            ["複製 / コピー / 貼り付け", "⌘ D / ⌘ C / ⌘ V"],
            ["画像をコピー", "⌘ Shift C"],
            ["Mermaid を図にする", "⌘ V"],
            ["キャンバスを移動", "2本指スクロール / Space＋ドラッグ"],
            ["拡大・縮小", "ピンチ / Ctrl＋ホイール"],
            ["全体を表示", "1"],
            ["元に戻す / やり直す", "⌘ Z / ⌘ Shift Z"],
            ["ファイルに保存", "⌘ S"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="field-help">
          Windowsでは⌘をCtrlに読み替えてください。囲みを解除しても中身は残ります。図形を削除するとつながった線も消えます。
        </p>
        <button className="primary" onClick={() => help.current?.close()}>
          閉じる
        </button>
      </dialog>
    </div>
  );
}
