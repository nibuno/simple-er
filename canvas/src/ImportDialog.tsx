import { useEffect, useRef, useState } from "react";
import { looksLikeFlowchart, readFlowchart } from "./flowchart";
import { decode, emptyDocument, makeNode, MAX_TEXT } from "./model";
import { Icon } from "./Icons";
import type { CanvasDocument } from "./types";

export type ImportKind = "mermaid" | "canvas" | "text";
export function readInput(text: string, fileName = "") {
  if (text.length > 2_000_000)
    throw new Error("読み込めるのは200万文字までです");
  if (/^\s*\{/.test(text)) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    if (json?.format === "simple-canvas")
      return { doc: decode(text), warnings: [], kind: "canvas" as const };
  }
  if (/\.(mmd|mermaid)$/i.test(fileName) || looksLikeFlowchart(text)) {
    const result = readFlowchart(text);
    if (!result.doc.nodes.length)
      throw new Error(
        result.warnings.join("\n") || "図形が読み取れませんでした",
      );
    result.doc.title =
      fileName.replace(/\.[^.]*$/, "").slice(0, 200) || "Mermaid の図";
    return { ...result, kind: "mermaid" as const };
  }
  if (text.length > MAX_TEXT)
    throw new Error(`テキストは${MAX_TEXT}文字までです`);
  const doc = emptyDocument();
  doc.nodes.push({ ...makeNode("note", { x: 0, y: 0 }), body: text });
  return { doc, warnings: [], kind: "text" as const };
}

export function ImportDialog({
  initialText,
  onClose,
  onImport,
}: {
  initialText: string;
  onClose: () => void;
  onImport: (
    doc: CanvasDocument,
    kind: ImportKind,
    newDiagram: boolean,
  ) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const [text, setText] = useState(initialText);
  const [fileName, setFileName] = useState("");
  const [newDiagram, setNewDiagram] = useState(false);
  const [pending, setPending] = useState<ReturnType<typeof readInput> | null>(
    null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function update(value: string, name = "") {
    setText(value);
    setFileName(name);
    setPending(null);
    setError("");
    readVersion.current++;
  }
  function submit() {
    try {
      const result = pending ?? readInput(text, fileName);
      if (!pending && result.warnings.length) {
        setPending(result);
        return;
      }
      onImport(result.doc, result.kind, newDiagram);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <dialog
      ref={dialog}
      className="help-dialog paste-dialog"
      aria-labelledby="paste-heading"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id="paste-heading">Mermaid を読み込む</h2>
        <button className="icon-button" aria-label="閉じる" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <label>
        Mermaid またはテキスト
        <textarea
          autoFocus
          rows={7}
          value={text}
          onChange={(e) => update(e.target.value)}
        />
      </label>
      <button className="secondary" onClick={() => file.current?.click()}>
        ファイルを開く
      </button>
      <input
        ref={file}
        hidden
        type="file"
        accept=".mmd,.mermaid,.txt,.md,text/plain"
        onChange={async (event) => {
          const input = event.currentTarget,
            selected = input.files?.[0];
          if (!selected) return;
          input.value = "";
          const version = ++readVersion.current;
          try {
            if (selected.size > 2_000_000)
              throw new Error("ファイルの上限は2MBです");
            const value = await selected.text();
            if (version === readVersion.current) update(value, selected.name);
          } catch (e) {
            if (version === readVersion.current)
              setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
      <fieldset>
        <legend>読み込み先</legend>
        <label>
          <input
            type="radio"
            checked={!newDiagram}
            onChange={() => setNewDiagram(false)}
            name="import-target"
          />
          今の図に追加
        </label>
        <label>
          <input
            type="radio"
            checked={newDiagram}
            onChange={() => setNewDiagram(true)}
            name="import-target"
          />
          新しい図
        </label>
      </fieldset>
      {pending && (
        <div className="import-issues" role="status">
          <strong>読み込み時のお知らせ</strong>
          <p>{pending.warnings.join("\n")}</p>
        </div>
      )}
      {error && (
        <p className="import-issues" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>キャンセル</button>
        <button className="primary" disabled={!text.trim()} onClick={submit}>
          {pending ? "読めた分を読み込む" : "読み込む"}
        </button>
      </div>
    </dialog>
  );
}
