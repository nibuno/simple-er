import type { CanvasNode, NodeShape } from "./types";

export const SHAPES = ["rectangle", "ellipse", "diamond", "cylinder"] as const;
export const shapeLabels: Record<NodeShape, string> = {
  rectangle: "箱",
  ellipse: "楕円",
  diamond: "ひし形",
  cylinder: "円柱",
};
export const shapeIcons = {
  rectangle: "box",
  ellipse: "ellipse",
  diamond: "diamond",
  cylinder: "cylinder",
} as const;

const cylinderCap = (h: number) => Math.min(18, h / 6);

export function minimumBoxHeight(shape: NodeShape, textHeight: number) {
  if (shape === "ellipse") return Math.max(100, (textHeight + 12) / 0.64);
  if (shape === "diamond") return Math.max(140, (textHeight + 12) / 0.44);
  if (shape === "cylinder") return Math.max(120, textHeight + 78);
  return Math.max(84, textHeight + 40);
}

// Keep the outline and text area identical on the canvas and in exports.
export function shapePaths({ shape, w, h }: CanvasNode) {
  if (shape === "ellipse")
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
  return {
    outline: `M 8 0 H ${w - 8} Q ${w} 0 ${w} 8 V ${h - 8} Q ${w} ${h} ${w - 8} ${h} H 8 Q 0 ${h} 0 ${h - 8} V 8 Q 0 0 8 0 Z`,
  };
}

export function boxTextArea({ shape, w, h }: CanvasNode) {
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
  return { x: 16, y: 20, w: w - 32, h: h - 40, centered: false };
}
