import { ImportDialog } from "../../shared/FileDialogs.tsx";
import { looksLikeFlowchart, readFlowchart } from "./flowchart";
import { decode, emptyDocument, makeNode, MAX_TEXT } from "./model";

import type { CanvasDocument } from "./types";

export type ImportKind = "mermaid" | "canvas" | "text";
function canvasFormat(text: string, filename: string) {
  if (/^\s*\{/.test(text)) return "JSON";
  if (looksLikeFlowchart(text)) return "Mermaid";
  if (/\.(json|simplecanvas)$/i.test(filename)) return "JSON";
  if (/\.(mmd|mermaid)$/i.test(filename)) return "Mermaid";
  return "テキスト";
}
export function readInput(
  text: string,
  fileName = "",
  format = canvasFormat(text, fileName),
) {
  if (text.length > 2_000_000)
    throw new Error("読み込めるのは200万文字までです");
  if (format === "JSON") {
    try {
      return {
        doc: decode(text.trimStart()),
        warnings: [],
        kind: "canvas" as const,
      };
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error("JSON として読み取れません。");
      throw error;
    }
  }
  if (format === "Mermaid") {
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

export function CanvasImportDialog({
  initialText,
  defaultNew,
  onClose,
  onImport,
}: {
  initialText: string;
  defaultNew: boolean;
  onClose: () => void;
  onImport: (
    doc: CanvasDocument,
    kind: ImportKind,
    newDiagram: boolean,
  ) => void;
}) {
  return (
    <ImportDialog
      initialText={initialText}
      defaultNew={defaultNew}
      formats="JSON · Mermaid · テキスト"
      detect={canvasFormat}
      accept=".json,.simplecanvas,.mmd,.mermaid,.txt,.md"
      maxBytes={2_000_000}
      prepare={({ text, filename, target }) => {
        const result = readInput(text, filename);
        return {
          warnings: result.warnings,
          apply: () => onImport(result.doc, result.kind, target === "new"),
        };
      }}
      onClose={onClose}
    />
  );
}
