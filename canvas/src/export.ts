import type { CanvasDocument, CanvasNode } from "./types";
import { noteContent, wrapText } from "./model";
import { documentRoutes, sceneBounds } from "./geometry";
import { boxTextArea, shapePaths } from "./shapes";
import { DEFAULT_COLORS, nodeAppearance, safeColor } from "./colors";
import { iconPath } from "./Icons";
import { textWidth } from "./text";
const esc = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
function textBlock(
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  lineHeight: number,
  color: string,
  weight = 400,
  anchor = "start",
) {
  if (!value) return "";
  return wrapText(value, width, size)
    .map(
      (line, i) =>
        '<text x="' +
        x +
        '" y="' +
        (y + i * lineHeight) +
        '" fill="' +
        color +
        '" font-size="' +
        size +
        '" font-weight="' +
        weight +
        '" text-anchor="' +
        anchor +
        '">' +
        esc(line) +
        "</text>",
    )
    .join("");
}
export function toSvg(doc: CanvasDocument) {
  const routes = documentRoutes(doc),
    b = sceneBounds(doc, routes),
    pad = 48;
  const width = Math.ceil(b.w + pad * 2),
    height = Math.ceil(b.h + pad * 2);
  const nodeSvg = (n: CanvasNode) => {
    const colors = nodeAppearance(n, doc);
    if (n.kind === "group")
      return (
        '<rect x="' +
        n.x +
        '" y="' +
        n.y +
        '" width="' +
        n.w +
        '" height="' +
        n.h +
        `" rx="10" fill="${colors.fill}" stroke="${colors.stroke}"/>` +
        textBlock(
          n.title,
          n.x + 18,
          n.y + 28,
          n.w - 36,
          13,
          22,
          colors.muted,
          500,
        )
      );
    if (n.kind === "box") {
      const area = boxTextArea(n),
        paths = shapePaths(n),
        titleHeight = n.title ? wrapText(n.title, area.w, 16).length * 24 : 0,
        descriptionHeight = n.description
          ? wrapText(n.description, area.w, 13).length * 21
          : 0,
        gap = n.title && n.description ? 7 : 0,
        textY =
          area.y +
          (area.centered
            ? (area.h - titleHeight - descriptionHeight - gap) / 2
            : 0),
        textX = n.x + area.x + (area.centered ? area.w / 2 : 0),
        anchor = area.centered ? "middle" : "start";
      // The icon sits before the name; the pair is centered together.
      const icon = n.icon ? iconPath(n.icon) : undefined,
        firstLine = n.title ? wrapText(n.title, area.w, 16)[0] : "",
        iconShift = icon ? (anchor === "middle" ? 10.5 : 21) : 0,
        iconX =
          (anchor === "middle"
            ? textX - (textWidth(firstLine, 16) + 21) / 2
            : textX) - n.x,
        iconSvg = icon
          ? `<path d="${icon}" transform="translate(${iconX} ${textY + 4}) scale(0.67)" fill="none" stroke="${colors.muted}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>`
          : "";
      return (
        `<g data-node-shape="${n.shape}" transform="translate(${n.x} ${n.y})"><path d="${paths.outline}" fill="${colors.fill}" stroke="${colors.stroke}"/>` +
        (paths.detail
          ? `<path d="${paths.detail}" fill="none" stroke="${colors.stroke}"/>`
          : "") +
        iconSvg +
        "</g>" +
        textBlock(
          n.title,
          textX + iconShift,
          n.y + textY + 18,
          area.w,
          16,
          24,
          colors.text,
          600,
          anchor,
        ) +
        textBlock(
          n.description,
          textX,
          n.y + textY + titleHeight + gap + 16,
          area.w,
          13,
          21,
          colors.muted,
          400,
          anchor,
        )
      );
    }
    const content = noteContent(n, doc),
      titleLines = content.title
        ? wrapText(content.title, n.w - 28, 13).length
        : 0;
    // A figure's memo is a pale card; free text is plain, as on the canvas.
    const card = n.attachedTo && colors.fill === "transparent";
    return (
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${card ? 8 : 0}" fill="${card ? DEFAULT_COLORS.memo : colors.fill}"/>` +
      textBlock(
        content.title,
        n.x + 14,
        n.y + 22,
        n.w - 28,
        13,
        22,
        colors.muted,
        500,
      ) +
      textBlock(
        content.body,
        n.x + 14,
        n.y + 24 + (titleLines ? titleLines * 22 + 8 : 0),
        n.w - 28,
        14,
        24,
        colors.text,
      )
    );
  };
  const frames = doc.nodes
    .filter((n) => n.kind === "group")
    .map(nodeSvg)
    .join("");
  const wires = doc.edges
    .map((e, i) => {
      const r = routes.get(e.id)!;
      const color = safeColor(e.strokeColor, DEFAULT_COLORS.line);
      const label = r.labelLines
        .map(
          (line, i) =>
            '<text x="' +
            r.label.x +
            '" y="' +
            (r.label.y - 7 + i * 18) +
            '" text-anchor="middle" font-size="12" fill="#52685c" stroke="#f8faf9" stroke-width="5" paint-order="stroke" stroke-linejoin="round">' +
            esc(line) +
            "</text>",
        )
        .join("");
      return (
        '<path d="' +
        r.path +
        `" fill="none" stroke="${color}" stroke-width="1.7" marker-end="url(#arrow-${i})"` +
        (e.dashed ? ' stroke-dasharray="7 5"' : "") +
        "/>" +
        label
      );
    })
    .join("");
  const content = doc.nodes
    .filter((n) => n.kind !== "group")
    .map(nodeSvg)
    .join("");
  const markers = doc.edges
    .map(
      (edge, i) =>
        `<marker id="arrow-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${safeColor(edge.strokeColor, DEFAULT_COLORS.line)}" stroke-width="1.5"/></marker>`,
    )
    .join("");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="' +
    (b.x - pad) +
    " " +
    (b.y - pad) +
    " " +
    width +
    " " +
    height +
    '"><title>' +
    esc(doc.title) +
    "</title><defs>" +
    markers +
    '</defs><rect x="' +
    (b.x - pad) +
    '" y="' +
    (b.y - pad) +
    '" width="' +
    width +
    '" height="' +
    height +
    '" fill="#f8faf9"/><g font-family="system-ui,-apple-system,BlinkMacSystemFont,Noto Sans JP,sans-serif">' +
    frames +
    wires +
    content +
    "</g></svg>"
  );
}
export function downloadFile(
  content: Blob | string,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content,
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export function filename(title: string) {
  return (
    title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "canvas"
  ).slice(0, 100);
}
export async function exportPng(doc: CanvasDocument) {
  const svg = toSvg(doc),
    b = sceneBounds(doc),
    width = b.w + 96,
    height = b.h + 96;
  const scale = Math.min(
    2,
    8192 / width,
    8192 / height,
    Math.sqrt(24000000 / (width * height)),
  );
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error("画像の変換に失敗しました。SVGでの保存を試してください。"),
        );
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("このブラウザでは画像に変換できません。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("PNGの保存に失敗しました。")),
        "image/png",
      ),
    );
    downloadFile(blob, filename(doc.title) + ".png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
