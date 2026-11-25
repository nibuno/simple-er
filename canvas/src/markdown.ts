import { strToU8, zipSync } from "fflate";
import { toSvg } from "./export";
import { memoNodes, memoOwnerName } from "./model";
import { memoStatusLabels } from "./types";
import type { CanvasDocument } from "./types";

// Names and memos are plain text in the editor. Keep them literal in Markdown.
const literal = (text: string) => text.replace(/([!-/:-@\[-`{-~])/g, "\\$1");
const heading = (text: string) => literal(text.replace(/\s+/g, " ").trim());

export function markdownArchive(doc: CanvasDocument) {
  const sections = [
    "# " + (heading(doc.title) || "無題のキャンバス"),
    "![図](./diagram.svg)",
  ];
  const memos = memoNodes(doc);
  for (const node of memos) {
    const status = node.memoStatus
      ? memoStatusLabels[node.memoStatus]
      : "未設定";
    sections.push(
      "## " + heading(memoOwnerName(node)) + "（" + status + "）",
      node.body
        .split(/\r\n?|\n/)
        .map(
          (line, i, lines) =>
            literal(line) + (line.trim() && lines[i + 1]?.trim() ? "  " : ""),
        )
        .join("\n"),
    );
  }
  if (!memos.length) sections.push("メモはありません。");
  const zip = zipSync({
    "README.md": strToU8(sections.join("\n\n") + "\n"),
    "diagram.svg": strToU8(toSvg(doc)),
  });
  return new Blob([zip], { type: "application/zip" });
}
