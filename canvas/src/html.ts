/// <reference types="vite/client" />
import { escapeXml as esc } from "../../shared/export";
import { toSvg } from "./export";
import type { SceneRoutes } from "./geometry";
import { memoNodes, memoOwnerName } from "./model";
import { memoStatusLabels, type CanvasDocument } from "./types";

export function viewerHtml(
  doc: CanvasDocument,
  template: string,
  computed?: SceneRoutes,
) {
  const memos = memoNodes(doc);
  const indexes = new Map(memos.map((node, i) => [node.id, i]));
  const diagram = toSvg(doc, [], computed, (node, svg) => {
    const index = indexes.get(node.attachedTo ?? node.id);
    if (index === undefined) return svg;
    const name = esc(memoOwnerName(memos[index]));
    return `<g data-memo="${index}" ${node.attachedTo ? "" : "data-owner"} role="button" tabindex="0" aria-label="${name}のメモを選択">${svg}</g>`;
  });
  const rows = memos.map((node, i) => {
    const status = node.memoStatus
      ? memoStatusLabels[node.memoStatus]
      : "未設定";
    return `<li><button data-memo="${i}"><span class="row-heading"><strong>${esc(memoOwnerName(node))}</strong><span data-status="${node.memoStatus ?? ""}">${status}</span></span><span class="memo-body">${esc(node.body)}</span></button></li>`;
  });
  const fields = {
    title: esc(doc.title || "無題のキャンバス"),
    diagram,
    memos: rows.length
      ? `<ul>${rows.join("")}</ul>`
      : "<p>この図にはメモがありません。</p>",
  };
  // Substitute only the template's slots, even when a memo contains a slot name.
  return template.replace(
    /{{(title|diagram|memos)}}/g,
    (_, key: keyof typeof fields) => fields[key],
  );
}
