import type { CanvasDocument, CanvasNode, Point } from "./types";
import { documentRoutes } from "./geometry";
import { clearSegment, interference, segments } from "./orthogonal";
import { connectionAxis, overlapArea } from "./spatial";

// Tidy is a local adjustment: distance along the flow and the existing order
// remain intact. This bound applies to each axis, rather than to a whole graph.
const MAX_MOVE = 48,
  ALIGN_TOLERANCE = 64;
type Axis = "x" | "y";
const extent = (axis: Axis) => (axis === "x" ? "w" : "h");
const center = (node: CanvasNode, axis: Axis) =>
  node[axis] + node[extent(axis)] / 2;

function alignmentGroups(
  doc: CanvasDocument,
  movable: Set<string>,
  axis: Axis,
) {
  const main: Axis = axis === "x" ? "y" : "x",
    nodes = new Map(
      doc.nodes.filter((n) => n.kind === "box").map((n) => [n.id, n]),
    ),
    groups = new Map([...nodes.keys()].map((id) => [id, new Set([id])]));
  const edges = doc.edges
    .filter((edge) => {
      const a = nodes.get(edge.from),
        b = nodes.get(edge.to);
      return (
        a &&
        b &&
        a !== b &&
        (movable.has(a.id) || movable.has(b.id)) &&
        connectionAxis(a, b) === main &&
        Math.abs(center(a, axis) - center(b, axis)) <= ALIGN_TOLERANCE
      );
    })
    .sort(
      (a, b) =>
        Math.abs(
          center(nodes.get(a.from)!, axis) - center(nodes.get(a.to)!, axis),
        ) -
          Math.abs(
            center(nodes.get(b.from)!, axis) - center(nodes.get(b.to)!, axis),
          ) || a.id.localeCompare(b.id),
    );
  for (const edge of edges) {
    const first = groups.get(edge.from)!,
      second = groups.get(edge.to)!;
    if (first === second) continue;
    const merged = [...new Set([...first, ...second])].map((id) =>
      nodes.get(id)!,
    );
    // A fork must not collapse into one line. Only combine shapes whose bodies
    // occupy separate positions along this particular connection direction.
    if (
      merged.some((a, i) =>
        merged
          .slice(i + 1)
          .some(
            (b) =>
              Math.max(a[main], b[main]) -
                Math.min(a[main] + a[extent(main)], b[main] + b[extent(main)]) <
              24,
          ),
      )
    )
      continue;
    const lower = Math.max(
        ...merged.map(
          (n) => center(n, axis) - (movable.has(n.id) ? MAX_MOVE : 0),
        ),
      ),
      upper = Math.min(
        ...merged.map(
          (n) => center(n, axis) + (movable.has(n.id) ? MAX_MOVE : 0),
        ),
      );
    if (lower > upper) continue;
    const group = new Set(merged.map((n) => n.id));
    for (const node of merged) groups.set(node.id, group);
  }
  return [...new Set(groups.values())]
    .filter((group) => group.size > 1)
    .map((group) =>
      [...group]
        .map((id) => nodes.get(id)!)
        .sort((a, b) => a.id.localeCompare(b.id)),
    )
    .sort((a, b) => a[0].id.localeCompare(b[0].id));
}

export function arrangeBoxes(
  doc: CanvasDocument,
  movable: Set<string>,
): Map<string, Point> {
  const originals = new Map(doc.nodes.map((n) => [n.id, n])),
    initial = new Map(
      doc.nodes
        .filter((n) => movable.has(n.id))
        .map((n) => [n.id, { x: n.x, y: n.y }]),
    ),
    groups = {
      x: alignmentGroups(doc, movable, "x"),
      y: alignmentGroups(doc, movable, "y"),
    };
  function project(points: Map<string, Point>): CanvasDocument {
    return {
      ...doc,
      nodes: doc.nodes.map((n) => {
        const point = points.get(n.id);
        if (point) return { ...n, ...point };
        const parent = n.attachedTo && originals.get(n.attachedTo),
          moved = n.attachedTo && points.get(n.attachedTo);
        return parent && moved
          ? { ...n, x: n.x + moved.x - parent.x, y: n.y + moved.y - parent.y }
          : n;
      }),
    };
  }
  function valid(candidate: CanvasDocument) {
    const bodies = candidate.nodes.filter((n) => n.kind !== "group");
    for (const [i, a] of bodies.entries()) {
      const oldA = originals.get(a.id)!;
      for (const b of bodies.slice(i + 1)) {
        const oldB = originals.get(b.id)!;
        if (
          a.x === oldA.x &&
          a.y === oldA.y &&
          b.x === oldB.x &&
          b.y === oldB.y
        )
          continue;
        if (overlapArea(a, b) > overlapArea(oldA, oldB) + 0.01) return false;
        // Preserve clear left/right and above/below relationships, including
        // unselected shapes and notes. No diagram-wide repacking is needed.
        for (const axis of ["x", "y"] as const) {
          const size = extent(axis);
          if (
            oldA[axis] + oldA[size] <= oldB[axis] &&
            a[axis] + a[size] > b[axis] + 0.01
          )
            return false;
          if (
            oldB[axis] + oldB[size] <= oldA[axis] &&
            b[axis] + b[size] > a[axis] + 0.01
          )
            return false;
        }
      }
    }
    return true;
  }
  function align(points: Map<string, Point>, axis: Axis) {
    let next = new Map(points);
    for (const group of groups[axis]) {
      const moving = group.filter((n) => movable.has(n.id)),
        lower = Math.max(
          ...group.map(
            (n) => center(n, axis) - (movable.has(n.id) ? MAX_MOVE : 0),
          ),
        ),
        upper = Math.min(
          ...group.map(
            (n) => center(n, axis) + (movable.has(n.id) ? MAX_MOVE : 0),
          ),
        ),
        mean =
          moving.reduce((sum, n) => sum + center(n, axis), 0) / moving.length;
      const targets = [
        ...new Set([
          Math.max(lower, Math.min(upper, mean)),
          ...group.map((n) => center(n, axis)),
        ]),
      ]
        .filter((value) => value >= lower && value <= upper)
        .sort((a, b) => Math.abs(a - mean) - Math.abs(b - mean) || a - b);
      for (const raw of targets) {
        const target = Math.round(raw * 1e6) / 1e6,
          trial = new Map(next);
        for (const n of moving)
          trial.set(n.id, {
            ...trial.get(n.id)!,
            [axis]: target - n[extent(axis)] / 2,
          });
        if (valid(project(trial))) {
          next = trial;
          break;
        }
      }
    }
    return next;
  }
  function score(points: Map<string, Point>) {
    const candidate = project(points),
      routes = documentRoutes(candidate),
      bodies = candidate.nodes.filter((n) => n.kind !== "group"),
      routed: {
        from: string;
        to: string;
        segments: ReturnType<typeof segments>;
      }[] = [];
    let total = 0;
    for (const edge of [...candidate.edges].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const route = routes.get(edge.id)!;
      if (route.points.length < 2) {
        total += 1e6;
        continue;
      }
      total += Math.max(0, route.points.length - 2) * 60;
      const parts = segments(route.points),
        occupied = routed
          .filter((r) => r.from !== edge.from && r.to !== edge.to)
          .flatMap((r) => r.segments);
      for (const { a, b } of parts) {
        total +=
          (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * 0.25 +
          interference(a, b, occupied) * 0.25;
        if (!clearSegment(a, b, bodies)) total += 1e6;
      }
      routed.push({ from: edge.from, to: edge.to, segments: parts });
    }
    // Original positions are anchors: a tidier wire must justify moving a box.
    for (const [id, point] of points) {
      const n = originals.get(id)!;
      total += ((point.x - n.x) ** 2 + (point.y - n.y) ** 2) / 24;
    }
    return total;
  }
  const horizontal = align(initial, "y"),
    vertical = align(initial, "x");
  let best = initial,
    bestScore = score(initial);
  const seen = new Set([JSON.stringify([...initial])]);
  for (const candidate of [
    horizontal,
    vertical,
    align(horizontal, "x"),
    align(vertical, "y"),
  ]) {
    const key = JSON.stringify([...candidate]);
    if (seen.has(key)) continue;
    seen.add(key);
    const cost = score(candidate);
    if (cost < bestScore - 0.01) {
      best = candidate;
      bestScore = cost;
    }
  }
  return best;
}
