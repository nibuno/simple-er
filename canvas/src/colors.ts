import type { CanvasDocument, CanvasNode } from "./types";

// Excalidraw's Open Color families: light fills and dark strokes.
// https://github.com/excalidraw/excalidraw/blob/master/packages/common/src/colors.ts
export const COLOR_FAMILIES = [
  { name: "灰", fill: "#e9ecef", stroke: "#343a40" },
  { name: "赤", fill: "#ffc9c9", stroke: "#e03131" },
  { name: "橙", fill: "#ffd8a8", stroke: "#e8590c" },
  { name: "黄", fill: "#ffec99", stroke: "#f08c00" },
  { name: "緑", fill: "#b2f2bb", stroke: "#2f9e44" },
  { name: "青緑", fill: "#96f2d7", stroke: "#099268" },
  { name: "青", fill: "#a5d8ff", stroke: "#1971c2" },
  { name: "紫", fill: "#d0bfff", stroke: "#6741d9" },
  { name: "ピンク", fill: "#fcc2d7", stroke: "#c2255c" },
] as const;
export const DEFAULT_COLORS = {
  background: "#f8faf9",
  fill: "#ffffff",
  frame: "#eff4f080",
  stroke: "#d5ddd9",
  line: "#84998e",
  text: "#263b35",
  muted: "#68766f",
  white: "#ffffff",
  black: "#1e1e1e",
  strongText: "#000000",
} as const;

export const validColor = (value: unknown) =>
  typeof value === "string" &&
  (value === "transparent" || /^#[0-9a-f]{6}$/i.test(value));
export const safeColor = (value: string | undefined, fallback: string) =>
  validColor(value) ? value! : fallback;

export function normalizeColor(value: string) {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex))
    return (
      "#" +
      [...hex]
        .map((digit) => digit + digit)
        .join("")
        .toLowerCase()
    );
  return /^[0-9a-f]{6}$/i.test(hex) ? "#" + hex.toLowerCase() : null;
}

export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function nodeAppearance(node: CanvasNode, doc: CanvasDocument) {
  const fill = safeColor(
    node.fillColor,
    node.kind === "box"
      ? DEFAULT_COLORS.fill
      : node.kind === "group"
        ? DEFAULT_COLORS.frame
        : "transparent",
  );
  const group = doc.nodes.find((n) => n.id === node.groupId);
  const background =
    fill !== "transparent"
      ? fill.slice(0, 7)
      : group?.fillColor && group.fillColor !== "transparent"
        ? safeColor(group.fillColor, DEFAULT_COLORS.background)
        : DEFAULT_COLORS.background;
  const text =
    contrastRatio(DEFAULT_COLORS.text, background) >= 4.5
      ? DEFAULT_COLORS.text
      : contrastRatio(DEFAULT_COLORS.white, background) >= 4.5
        ? DEFAULT_COLORS.white
        : DEFAULT_COLORS.strongText;
  return {
    fill,
    // Text sits on a color the user chose, rather than the theme's surface.
    customBackground:
      validColor(node.fillColor) && node.fillColor !== "transparent"
        ? true
        : fill === "transparent" && background !== DEFAULT_COLORS.background,
    stroke: safeColor(node.strokeColor, DEFAULT_COLORS.stroke),
    text,
    muted:
      contrastRatio(DEFAULT_COLORS.muted, background) >= 4.5
        ? DEFAULT_COLORS.muted
        : text,
  };
}
