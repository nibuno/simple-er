import type { CanvasNode, NodeShape } from "./types";

export const SHAPES = [
  "rectangle",
  "ellipse",
  "circle",
  "diamond",
  "cylinder",
  "person",
  "cloud",
  "screen",
  "document",
] as const;
export const shapeLabels: Record<NodeShape, string> = {
  rectangle: "箱",
  ellipse: "楕円",
  circle: "円",
  diamond: "ひし形",
  cylinder: "円柱",
  person: "人",
  cloud: "クラウド",
  screen: "画面",
  document: "書類",
};
export const shapeIcons = {
  rectangle: "box",
  ellipse: "ellipse",
  circle: "circle",
  diamond: "diamond",
  cylinder: "cylinder",
  person: "person",
  cloud: "cloud",
  screen: "screen",
  document: "document",
} as const;
// The tool rail shows the shapes used most; the rest are one click away.
export const RAIL_SHAPES: NodeShape[] = [
  "rectangle",
  "person",
  "cylinder",
  "cloud",
];

// Position the memo label in a free corner, or below a curved shape's text.
export function memoMarker(node: CanvasNode) {
  const { shape, w, h } = node;
  if (shape === "person") return { x: w - 2, y: 10, centered: false };
  if (["rectangle", "screen", "document"].includes(shape))
    return { x: w - 8, y: h - 15, centered: false };
  const inset = shape === "cylinder" ? 12 : boxTextArea(node).y / 2 + 4;
  return { x: w / 2, y: h - inset - 8, centered: true };
}

const cylinderCap = (h: number) => Math.min(18, h / 6);
// Scale the portrait with its frame and keep its caption directly underneath.
export function personLayout(node: CanvasNode) {
  const size = Math.min(node.w / 2, 84);
  const top = node.body.trim() ? 22 : 8;
  return {
    size,
    top,
    captionY: top + size + 6,
    shoulderY: top + size * 0.82,
  };
}
const SCREEN_BAR = 18;
const FOLD = 16;

export const minimumWidth = (shape: NodeShape) =>
  shape === "person" ? 80 : shape === "circle" ? 100 : 160;

export function minimumBoxHeight(node: CanvasNode, textHeight: number) {
  const { shape } = node;
  if (shape === "ellipse") return Math.max(100, (textHeight + 12) / 0.64);
  if (shape === "circle") return Math.max(100, (textHeight + 12) / 0.6);
  if (shape === "diamond") return Math.max(140, (textHeight + 12) / 0.44);
  if (shape === "cylinder") return Math.max(120, textHeight + 78);
  if (shape === "person")
    return Math.max(
      84,
      personLayout(node).captionY + Math.max(24, textHeight) + 4,
    );
  if (shape === "cloud") return Math.max(110, (textHeight + 12) / 0.5);
  if (shape === "screen") return Math.max(96, SCREEN_BAR + textHeight + 36);
  return Math.max(84, textHeight + 40);
}

// Keep the outline and text area identical on the canvas and in exports.
export function shapePaths(node: CanvasNode): {
  outline: string;
  detail?: string;
} {
  const { shape, w, h } = node;
  if (shape === "ellipse" || shape === "circle")
    return {
      outline: `M 0 ${h / 2} A ${w / 2} ${h / 2} 0 1 1 ${w} ${h / 2} A ${w / 2} ${h / 2} 0 1 1 0 ${h / 2} Z`,
    };
  if (shape === "diamond")
    return {
      outline: `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`,
    };
  if (shape === "cylinder") {
    const cap = cylinderCap(h);
    return {
      outline: `M 0 ${cap} A ${w / 2} ${cap} 0 0 1 ${w} ${cap} V ${h - cap} A ${w / 2} ${cap} 0 0 1 0 ${h - cap} Z`,
      detail: `M 0 ${cap} A ${w / 2} ${cap} 0 0 0 ${w} ${cap}`,
    };
  }
  if (shape === "person") {
    const { size, top } = personLayout(node);
    const c = w / 2,
      r = size * 0.22;
    const point = (x: number, y: number) => `${c + x * size} ${top + y * size}`;
    return {
      outline:
        `M ${point(-0.22, 0.22)} a ${r} ${r} 0 1 1 ${2 * r} 0 a ${r} ${r} 0 1 1 ${-2 * r} 0 Z ` +
        `M ${point(-0.48, 1)} Q ${point(-0.48, 0.55)} ${point(0, 0.55)} Q ${point(0.48, 0.55)} ${point(0.48, 1)} Z`,
    };
  }
  if (shape === "cloud") {
    const p = (x: number, y: number) => `${x * w} ${y * h}`;
    return {
      outline:
        `M ${p(0.22, 0.92)} C ${p(0.04, 0.92)} ${p(0, 0.6)} ${p(0.16, 0.54)} ` +
        `C ${p(0.13, 0.26)} ${p(0.42, 0.1)} ${p(0.52, 0.3)} ` +
        `C ${p(0.62, 0.08)} ${p(0.92, 0.16)} ${p(0.88, 0.44)} ` +
        `C ${p(1, 0.48)} ${p(1, 0.92)} ${p(0.8, 0.92)} Z`,
    };
  }
  if (shape === "screen")
    return {
      outline: `M 6 0 H ${w - 6} Q ${w} 0 ${w} 6 V ${h - 6} Q ${w} ${h} ${w - 6} ${h} H 6 Q 0 ${h} 0 ${h - 6} V 6 Q 0 0 6 0 Z`,
      detail:
        `M 0 ${SCREEN_BAR} H ${w} ` +
        [10, 17, 24]
          .map(
            (x) =>
              `M ${x - 1.5} 9 A 1.5 1.5 0 1 1 ${x + 1.5} 9 A 1.5 1.5 0 1 1 ${x - 1.5} 9`,
          )
          .join(" "),
    };
  if (shape === "document")
    return {
      outline: `M 0 0 H ${w - FOLD} L ${w} ${FOLD} V ${h} H 0 Z`,
      detail: `M ${w - FOLD} 0 V ${FOLD} H ${w}`,
    };
  return {
    outline: `M 8 0 H ${w - 8} Q ${w} 0 ${w} 8 V ${h - 8} Q ${w} ${h} ${w - 8} ${h} H 8 Q 0 ${h} 0 ${h - 8} V 8 Q 0 0 8 0 Z`,
  };
}

export function boxTextArea(node: CanvasNode) {
  const { shape, w, h } = node;
  // A circle keeps its text inside the square that fits within it.
  if (shape === "circle")
    return { x: w * 0.15, y: h * 0.2, w: w * 0.7, h: h * 0.6, centered: true };
  if (shape === "ellipse")
    return {
      x: w * 0.18,
      y: h * 0.18,
      w: w * 0.64,
      h: h * 0.64,
      centered: true,
    };
  if (shape === "diamond")
    return {
      x: w * 0.28,
      y: h * 0.28,
      w: w * 0.44,
      h: h * 0.44,
      centered: true,
    };
  if (shape === "cylinder") {
    const cap = cylinderCap(h);
    return {
      x: 16,
      y: 2 * cap + 12,
      w: w - 32,
      h: h - 3 * cap - 24,
      centered: true,
    };
  }
  if (shape === "person") {
    const { captionY } = personLayout(node);
    return { x: 4, y: captionY, w: w - 8, h: h - captionY, centered: true };
  }
  if (shape === "cloud")
    return { x: w * 0.2, y: h * 0.36, w: w * 0.6, h: h * 0.5, centered: true };
  if (shape === "screen")
    return {
      x: 16,
      y: SCREEN_BAR + 12,
      w: w - 32,
      h: h - SCREEN_BAR - 24,
      centered: true,
    };
  if (shape === "document")
    return { x: 16, y: 20, w: w - 16 - FOLD - 8, h: h - 40, centered: true };
  return { x: 16, y: 20, w: w - 32, h: h - 40, centered: true };
}
