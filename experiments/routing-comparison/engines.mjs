import ELK from "elkjs/lib/elk.bundled.js";
import { AvoidLib } from "libavoid-js";
import {
  height,
  tableWidth,
  port,
  connectionSides,
  simplify,
  routeEdges,
  PAD,
  HEADER,
  ROW,
} from "../../src/geometry.ts";
import { tidyDiagram } from "../../src/layout.ts";

const elk = new ELK();
export const settings = {
  avoid: {
    shapeBufferDistance: 8,
    idealNudgingDistance: 12,
    segmentPenalty: 180,
    crossingPenalty: 160,
  },
  elk: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.randomSeed": "1",
    "elk.spacing.nodeNode": "96",
    // 64 between the 28px external ports gives a 120px table-to-table gap.
    "elk.layered.spacing.nodeNodeBetweenLayers": "64",
    "elk.spacing.edgeNode": "18",
    "elk.spacing.edgeEdge": "12",
    "elk.layered.spacing.edgeNodeBetweenLayers": "18",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
    "elk.padding": "[top=80,left=80,bottom=80,right=80]",
  },
};
const start = performance.now();
await AvoidLib.load();
export const wasmLoadMs = performance.now() - start;
const A = AvoidLib.getInstance();
const clone = (d) => structuredClone(d);
const ordered = (xs) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const key = (p) => `${p.table}:${p.row}:${p.side}`;

export function effectiveDiagram(input) {
  const d = clone(input),
    byId = new Map(d.tables.map((t) => [t.id, t]));
  d.edges = ordered(d.edges).map((e) => {
    const [a, b] = connectionSides(
      byId.get(e.from.table),
      byId.get(e.to.table),
    );
    return {
      ...e,
      manual: false,
      trunk: null,
      from: { ...e.from, side: a },
      to: { ...e.to, side: b },
    };
  });
  return d;
}
export function current(input, tidy = true) {
  const diagram = tidy ? tidyDiagram(clone(input)) : clone(input);
  return { diagram, routes: routeEdges(diagram.edges, diagram.tables) };
}

// The same 28px column stub used by SimpleER is protected by checkpoints.
// Ports remain pinned to their exact column, and common endpoints can share paths.
export function avoidSession(input, protectStubs = true) {
  let diagram = effectiveDiagram(input);
  const router = new A.Router(A.RouterFlag.OrthogonalRouting.value);
  for (const [name, value] of Object.entries(settings.avoid))
    router.setRoutingParameter(A.RoutingParameter[name], value);
  router.setRoutingOption(
    A.RoutingOption.nudgeSharedPathsWithCommonEndPoint,
    false,
  );
  router.setRoutingOption(
    A.RoutingOption.nudgeOrthogonalSegmentsConnectedToShapes,
    false,
  );
  const shapes = new Map(),
    pins = new Map(),
    conns = new Map();
  function addTable(t) {
    const p = new A.Point(t.x, t.y),
      q = new A.Point(t.x + tableWidth(t), t.y + height(t));
    const rect = new A.Rectangle(p, q),
      shape = new A.ShapeRef(router, rect);
    rect.delete();
    p.delete();
    q.delete();
    shapes.set(t.id, shape);
  }
  ordered(diagram.tables).forEach(addTable);
  function endpoint(p) {
    if (!pins.has(key(p))) {
      const t = diagram.tables.find((t) => t.id === p.table);
      const id = p.row * 2 + (p.side === "left" ? 1 : 2);
      new A.ShapeConnectionPin(
        shapes.get(t.id),
        id,
        p.side === "left" ? 0 : tableWidth(t),
        HEADER + ROW * (p.row + 0.5),
        false,
        0,
        p.side === "left" ? 4 : 8,
      ).setExclusive(false);
      pins.set(key(p), id);
    }
    return new A.ConnEnd(shapes.get(p.table), pins.get(key(p)));
  }
  function guards(e, c) {
    if (!protectStubs) return;
    const checkpoints = new A.CheckpointVector();
    for (const [i, p] of [e.from, e.to].entries()) {
      const t = diagram.tables.find((t) => t.id === p.table),
        at = port(t, p.row, p.side),
        right = p.side === "right";
      const point = new A.Point(at.x + (right ? PAD : -PAD), at.y);
      // Arrival/departure direction flags are measured looking from the checkpoint.
      const guard = new A.Checkpoint(
        point,
        i === 0 ? (right ? 4 : 8) : 15,
        i === 1 ? (right ? 4 : 8) : 15,
      );
      checkpoints.push_back(guard);
      guard.delete();
      point.delete();
    }
    c.setRoutingCheckpoints(checkpoints);
    checkpoints.delete();
  }
  for (const e of diagram.edges) {
    const a = endpoint(e.from),
      b = endpoint(e.to),
      c = new A.ConnRef(router, a, b);
    a.delete();
    b.delete();
    c.setRoutingType(A.ConnType.ConnType_Orthogonal);
    guards(e, c);
    conns.set(e.id, c);
  }
  function result() {
    router.processTransaction();
    const routes = new Map(
      diagram.edges.map((e) => {
        const line = conns.get(e.id).displayRoute();
        const points = Array.from({ length: line.size() }, (_, i) => {
          const p = line.at(i);
          return { x: p.x, y: p.y };
        });
        return [
          e.id,
          {
            points: simplify(points),
            fromSide: e.from.side,
            toSide: e.to.side,
          },
        ];
      }),
    );
    return { diagram: clone(diagram), routes };
  }
  return {
    result,
    close: () => router.delete(),
    addObstacle(t) {
      diagram.tables.push(clone(t));
      addTable(t);
      return result();
    },
    moveTable(id, dx, dy) {
      const t = diagram.tables.find((t) => t.id === id);
      t.x += dx;
      t.y += dy;
      router.moveShape_delta(shapes.get(id), dx, dy);
      for (const e of diagram.edges)
        if (e.from.table === id || e.to.table === id)
          guards(e, conns.get(e.id));
      return result();
    },
  };
}
export function avoid(input) {
  const s = avoidSession(input);
  try {
    return s.result();
  } finally {
    s.close();
  }
}

export async function elkLayout(input) {
  // Use the same sides as the current tidy result, not the user's previous coordinates.
  const base = effectiveDiagram(tidyDiagram(clone(input))),
    ports = new Map();
  for (const e of base.edges)
    for (const p of [e.from, e.to]) ports.set(key(p), p);
  const output = await elk.layout({
    id: "root",
    layoutOptions: settings.elk,
    children: ordered(base.tables).map((t) => ({
      id: t.id,
      width: tableWidth(t),
      height: height(t),
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [...ports.entries()]
        .filter(([, p]) => p.table === t.id)
        .map(([id, p]) => ({
          id,
          x: p.side === "right" ? tableWidth(t) + PAD : -PAD,
          y: HEADER + ROW * (p.row + 0.5),
          width: 0,
          height: 0,
          layoutOptions: {
            "elk.port.side": p.side === "right" ? "EAST" : "WEST",
            "elk.port.borderOffset": String(PAD),
          },
        })),
    })),
    edges: base.edges.map((e) => ({
      id: e.id,
      sources: [key(e.from)],
      targets: [key(e.to)],
    })),
  });
  const nodes = new Map(output.children.map((t) => [t.id, t]));
  const diagram = {
    ...base,
    tables: base.tables.map((t) => ({
      ...t,
      x: nodes.get(t.id).x,
      y: nodes.get(t.id).y,
    })),
  };
  const byId = new Map(diagram.tables.map((t) => [t.id, t]));
  const routes = new Map(
    output.edges.map((e) => {
      if (e.sections?.length !== 1)
        throw new Error(
          `Unexpected ELK sections for ${e.id}: ${e.sections?.length}`,
        );
      const original = base.edges.find((x) => x.id === e.id),
        s = e.sections[0];
      return [
        e.id,
        {
          points: simplify([
            port(
              byId.get(original.from.table),
              original.from.row,
              original.from.side,
            ),
            s.startPoint,
            ...(s.bendPoints ?? []),
            s.endPoint,
            port(
              byId.get(original.to.table),
              original.to.row,
              original.to.side,
            ),
          ]),
          fromSide: original.from.side,
          toSide: original.to.side,
        },
      ];
    }),
  );
  return { diagram, routes };
}
