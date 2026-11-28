import { strToU8, zipSync } from "fflate";
import { toSvg } from "./export";
import { memoNodes, memoOwnerName } from "./model";
import { memoStatusLabels } from "./types";
import type { CanvasDocument } from "./types";

// Names and memos are plain text in the editor. Keep them literal in Markdown.
function literal(text: string) {
  const word = /[\p{L}\p{N}]/u;
  return (
    text
      .replace(
        /[\\*`[\]<~|]|_+|&(?=(?:#\d+|#x[\da-f]+|[a-z]\w*);)/gi,
        (mark, at) => {
          if (
            mark.startsWith("_") &&
            word.test(text[at - 1] ?? "") &&
            word.test(text[at + mark.length] ?? "")
          )
            return mark;
          return Array.from(mark, (c) => "\\" + c).join("");
        },
      )
      // A list, quote, heading or horizontal rule needs escaping only at line start.
      .replace(
        /^([ \t]*)(#{1,6}(?=\s|$)|>|[-+](?=\s|$)|-(?=[- \t]*$)|=(?==*\s*$))/,
        "$1\\$2",
      )
      .replace(/^([ \t]*\d{1,9})([.)])(?=\s|$)/, "$1\\$2")
  );
}
const heading = (text: string) =>
  literal(text.replace(/\s+/g, " ").trim()).replace(/(\s)(#+)$/, "$1\\$2");

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
