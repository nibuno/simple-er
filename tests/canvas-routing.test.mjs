import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrange,
  clone,
  decode,
  emptyDocument,
  encode,
  growNodes,
  makeNode,
  moveNodes,
  attachNote,
  noteContent,
} from "../canvas/src/model.ts";
import { documentRoutes, routeEdge } from "../canvas/src/geometry.ts";
import { toSvg } from "../canvas/src/export.ts";

function graph(specs, links) {
  const doc = emptyDocument();
  doc.nodes = specs.map(([id, shape = "rectangle", w, h], i) => ({
    ...makeNode(
      "box",
      { x: (i % 3) * 340 + 40, y: Math.floor(i / 3) * 250 + 60 },
      shape,
    ),
    id,
    title: id,
    ...(w ? { w } : {}),
    ...(h ? { h } : {}),
  }));
  doc.edges = links.map(([from, to, label = ""], i) => ({
    id: "link-" + i,
    from,
    to,
    label,
    dashed: false,
  }));
  return growNodes(doc);
}
const cy = (node) => node.y + node.h / 2;
const cx = (node) => node.x + node.w / 2;
const byId = (doc, id) => doc.nodes.find((n) => n.id === id);
function place(doc, coordinates) {
  for (const [id, x, y] of coordinates) Object.assign(byId(doc, id), { x, y });
  return doc;
}
const near = (a, b) =>
  assert.ok(Math.abs(a - b) < 0.01, `${a} should align with ${b}`);
function crossesBox(a, b, n) {
  return a.x === b.x
    ? a.x > n.x + 0.5 &&
        a.x < n.x + n.w - 0.5 &&
        Math.max(a.y, b.y) > n.y + 0.5 &&
        Math.min(a.y, b.y) < n.y + n.h - 0.5
    : a.y > n.y + 0.5 &&
        a.y < n.y + n.h - 0.5 &&
        Math.max(a.x, b.x) > n.x + 0.5 &&
        Math.min(a.x, b.x) < n.x + n.w - 0.5;
}
function checkRoutes(doc) {
  const routes = documentRoutes(doc),
    obstacles = doc.nodes.filter((n) => n.kind !== "group");
  for (const edge of doc.edges) {
    const route = routes.get(edge.id);
    assert.ok(route.points.length >= 2, edge.id);
    for (const [point, id] of [
      [route.points[0], edge.from],
      [route.points.at(-1), edge.to],
    ]) {
      const n = byId(doc, id);
      assert.ok(
        (Math.abs(point.y - cy(n)) < 0.001 &&
          [n.x, n.x + n.w].includes(point.x)) ||
          (Math.abs(point.x - n.x - n.w / 2) < 0.001 &&
            [n.y, n.y + n.h].includes(point.y)),
        "connection stays on the shape boundary",
      );
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      assert.ok(a.x === b.x || a.y === b.y, "orthogonal route");
      for (const obstacle of obstacles)
        assert.equal(
          crossesBox(a, b, obstacle),
          false,
          edge.id + " must avoid " + obstacle.id,
        );
    }
  }
  return routes;
}
function crossings(routes) {
  let count = 0;
  const paths = [...routes.values()];
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      for (let p = 1; p < paths[i].points.length; p++)
        for (let q = 1; q < paths[j].points.length; q++) {
          const a = paths[i].points[p - 1],
            b = paths[i].points[p],
            c = paths[j].points[q - 1],
            d = paths[j].points[q];
          if ((a.x === b.x) === (c.x === d.x)) continue;
          const [v1, v2, h1, h2] = a.x === b.x ? [a, b, c, d] : [c, d, a, b];
          if (
            v1.x > Math.min(h1.x, h2.x) &&
            v1.x < Math.max(h1.x, h2.x) &&
            h1.y > Math.min(v1.y, v2.y) &&
            h1.y < Math.max(v1.y, v2.y)
          )
            count++;
        }
    }
  return count;
}
const positions = (doc) =>
  doc.nodes
    .map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))
    .sort((a, b) => a.id.localeCompare(b.id));

test("tidy straightens a horizontal mixed-height flow without changing its distances or contents", () => {
  const doc = place(
      graph(
        [
          ["browser", "ellipse"],
          ["api"],
          ["decision", "diamond"],
          ["db", "cylinder"],
        ],
        [
          ["browser", "api"],
          ["api", "decision"],
          ["decision", "db"],
        ],
      ),
      [
        ["browser", 40, 120],
        ["api", 400, 142],
        ["decision", 740, 92],
        ["db", 1160, 106],
      ],
    ),
    before = clone(doc),
    next = arrange(doc, []);
  assert.deepEqual(doc, before);
  for (const n of next.nodes) {
    near(cy(n), cy(next.nodes[0]));
    assert.equal(n.x, byId(doc, n.id).x);
    assert.ok(Math.abs(n.y - byId(doc, n.id).y) <= 16);
    assert.deepEqual({ ...n, x: 0, y: 0 }, { ...byId(doc, n.id), x: 0, y: 0 });
  }
  for (const route of checkRoutes(next).values())
    assert.equal(route.points.length, 2, "no small steps between heights");
  assert.deepEqual(arrange(next, []), next);
  assert.deepEqual(decode(encode(next)), next);
});
test("branches and a join align at their connection centers without crossing", () => {
  const doc = place(
      graph(
        [
          ["root", "ellipse"],
          ["upper", "rectangle", 200, 100],
          ["lower", "cylinder", 240, 140],
          ["end", "diamond"],
        ],
        [
          ["root", "upper", "受け付ける"],
          ["root", "lower", "保存する"],
          ["upper", "end"],
          ["lower", "end"],
        ],
      ),
      [
        ["root", 40, 200],
        ["upper", 500, 70],
        ["lower", 500, 330],
        ["end", 1020, 170],
      ],
    ),
    next = arrange(doc, []);
  const middle = (cy(byId(next, "upper")) + cy(byId(next, "lower"))) / 2;
  near(cy(byId(next, "root")), middle);
  near(cy(byId(next, "end")), middle);
  assert.deepEqual(next, doc, "a clean fork and join need no movement");
  assert.equal(crossings(checkRoutes(next)), 0);
});
test("a vertical mixed-width flow keeps its height and direction while its connections become straight", () => {
  const doc = place(
      graph(
        [
          ["start", "ellipse"],
          ["api"],
          ["decision", "diamond"],
          ["db", "cylinder"],
        ],
        [
          ["start", "api"],
          ["api", "decision"],
          ["decision", "db"],
        ],
      ),
      [
        ["start", 400, 40],
        ["api", 432, 340],
        ["decision", 388, 620],
        ["db", 420, 980],
      ],
    ),
    before = clone(doc),
    next = arrange(doc, []);
  assert.deepEqual(doc, before);
  for (const n of next.nodes) {
    const old = byId(doc, n.id);
    near(cx(n), cx(next.nodes[0]));
    assert.equal(n.y, old.y);
    assert.ok(Math.abs(n.x - old.x) <= 24);
    assert.deepEqual({ ...n, x: 0 }, { ...old, x: 0 });
  }
  for (const route of checkRoutes(next).values())
    assert.equal(route.points.length, 2);
  assert.deepEqual(arrange(next, []), next);
  assert.deepEqual(decode(encode(next)), next);
});
test("an L-shaped flow keeps both directions, and disconnected figures stay exactly where placed", () => {
  const doc = place(
      graph(
        [
          ["a", "ellipse"],
          ["b"],
          ["c", "diamond"],
          ["d", "cylinder"],
          ["separate"],
        ],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "d"],
        ],
      ),
      [
        ["a", 80, 60],
        ["b", 500, 90],
        ["c", 468, 500],
        ["d", 850, 526],
        ["separate", -600, 850],
      ],
    ),
    next = arrange(doc, []);
  assert.ok(byId(next, "b").x > byId(next, "a").x + byId(next, "a").w);
  assert.ok(byId(next, "c").y > byId(next, "b").y + byId(next, "b").h);
  assert.ok(byId(next, "d").x > byId(next, "c").x + byId(next, "c").w);
  for (const n of next.nodes) {
    const old = byId(doc, n.id);
    assert.ok(Math.abs(n.x - old.x) <= 24 && Math.abs(n.y - old.y) <= 24);
  }
  assert.deepEqual(byId(next, "separate"), byId(doc, "separate"));
  for (const route of checkRoutes(next).values())
    assert.equal(route.points.length, 2);
  assert.deepEqual(arrange(next, []), next);
});
test("a vertical fork and join retain their branch order and use one clear horizontal corridor", () => {
  const doc = place(
      graph(
        [
          ["start", "ellipse"],
          ["left"],
          ["right", "cylinder"],
          ["end", "ellipse"],
        ],
        [
          ["start", "left", "続行"],
          ["start", "right", "保留"],
          ["left", "end"],
          ["right", "end"],
        ],
      ),
      [
        ["start", 400, 40],
        ["left", 160, 360],
        ["right", 640, 360],
        ["end", 400, 720],
      ],
    ),
    next = arrange(doc, []);
  assert.deepEqual(next, doc);
  const routes = checkRoutes(next);
  assert.equal(crossings(routes), 0);
  const outgoing = [routes.get("link-0"), routes.get("link-1")];
  near(outgoing[0].points[1].y, outgoing[1].points[1].y);
});
test("a label beside a vertical straight line stays clear of the line and both shapes", () => {
  const doc = place(
      graph([["a"], ["b", "cylinder"]], [["a", "b", "注文を保存する"]]),
      [
        ["a", 400, 40],
        ["b", 420, 400],
      ],
    ),
    next = arrange(doc, []),
    route = checkRoutes(next).get("link-0");
  assert.equal(route.points.length, 2);
  assert.ok(Math.abs(route.label.x - route.points[0].x) > 48);
  assert.ok(route.label.y > byId(next, "a").y + byId(next, "a").h + 20);
  assert.ok(route.label.y < byId(next, "b").y - 20);
  const svg = toSvg(next);
  assert.ok(svg.includes('x="' + route.label.x + '"'));
  assert.ok(svg.includes("注文を保存する"));
});
test("widely separated diagonal positions are retained instead of being repacked", () => {
  const doc = place(
    graph(
      [["a"], ["b"], ["c"]],
      [
        ["a", "b"],
        ["b", "c"],
      ],
    ),
    [
      ["a", -300, 80],
      ["b", 200, 500],
      ["c", 800, -200],
    ],
  );
  assert.deepEqual(arrange(doc, []), doc);
  checkRoutes(doc);
});
test("selected figures align to a connected fixed figure without moving the fixed endpoint", () => {
  const doc = place(
      graph(
        [["fixed"], ["a"], ["b"]],
        [
          ["fixed", "a"],
          ["a", "b"],
        ],
      ),
      [
        ["fixed", 40, 60],
        ["a", 380, 76],
        ["b", 720, 82],
      ],
    ),
    next = arrange(doc, ["a", "b"]);
  assert.deepEqual(byId(next, "fixed"), byId(doc, "fixed"));
  for (const n of next.nodes) near(cy(n), cy(byId(next, "fixed")));
  for (const route of checkRoutes(next).values())
    assert.equal(route.points.length, 2);
});
test("tidy retains an offset when straightening would create overlaps with fixed obstacles", () => {
  const doc = place(
      graph([["a"], ["b"], ["below-a"], ["above-b"]], [["a", "b"]]),
      [
        ["a", 40, 60],
        ["b", 380, 92],
        ["below-a", 40, 168],
        ["above-b", 380, -16],
      ],
    ),
    next = arrange(doc, ["a", "b"]);
  assert.deepEqual(next, doc);
  checkRoutes(next);
});
test("tidy keeps the fork in place and only aligns its nearby continuing branch", () => {
  const doc = place(
      graph(
        [
          ["start", "ellipse"],
          ["fork"],
          ["terminal", "cylinder"],
          ["continue"],
          ["end", "diamond"],
        ],
        [
          ["start", "fork"],
          ["fork", "terminal"],
          ["fork", "continue"],
          ["continue", "end"],
        ],
      ),
      [
        ["start", 40, 200],
        ["fork", 400, 210],
        ["terminal", 800, 330],
        ["continue", 800, 80],
        ["end", 1200, 34],
      ],
    ),
    next = arrange(doc, []),
    routes = checkRoutes(next);
  for (const id of ["start", "fork", "terminal"])
    assert.deepEqual(byId(next, id), byId(doc, id));
  assert.equal(routes.get("link-0").points.length, 2);
  assert.equal(routes.get("link-3").points.length, 2);
  assert.equal(crossings(routes), 0);
});
test("branch order and local adjustments remain stable when arrays are reordered", () => {
  const doc = place(
    graph(
      [["root"], ["a_parent"], ["z_parent"], ["z_child"], ["a_child"]],
      [
        ["root", "a_parent"],
        ["root", "z_parent"],
        ["a_parent", "z_child"],
        ["z_parent", "a_child"],
      ],
    ),
    [
      ["root", 40, 200],
      ["a_parent", 400, 40],
      ["z_parent", 400, 380],
      ["z_child", 800, 64],
      ["a_child", 800, 356],
    ],
  );
  const next = arrange(doc, []),
    changed = clone(doc);
  changed.nodes.reverse();
  changed.edges.reverse();
  const reordered = arrange(changed, []);
  assert.deepEqual(positions(next), positions(reordered));
  assert.equal(crossings(checkRoutes(next)), 0);
  assert.deepEqual(
    [...documentRoutes(next)].sort(),
    [...documentRoutes(reordered)].sort(),
  );
  near(cy(byId(next, "a_parent")), cy(byId(next, "z_child")));
  near(cy(byId(next, "z_parent")), cy(byId(next, "a_child")));
});
test("a connection skipping a shape has a clear corridor and no crossing", () => {
  const doc = place(
      graph(
        [["start", "ellipse"], ["middle"], ["end", "cylinder"]],
        [
          ["start", "middle"],
          ["middle", "end"],
          ["start", "end", "直接保存"],
        ],
      ),
      [
        ["start", 40, 60],
        ["middle", 400, 70],
        ["end", 760, 50],
      ],
    ),
    next = arrange(doc, []);
  assert.equal(crossings(checkRoutes(next)), 0);
});
test("cycles use distinct routes and self connections avoid the other shapes", () => {
  const doc = graph(
      [
        ["a", "rectangle", 200, 100],
        ["b", "diamond", 240, 180],
        ["c", "cylinder"],
      ],
      [
        ["a", "b"],
        ["b", "a"],
        ["a", "a"],
        ["b", "c"],
      ],
    ),
    next = arrange(doc, []),
    routes = checkRoutes(next);
  assert.notDeepEqual(
    routes.get("link-0").points,
    [...routes.get("link-1").points].reverse(),
  );
  assert.deepEqual(arrange(next, []), next);
});
test("a selected flow stays clear of fixed shapes and leaves free notes unchanged", () => {
  const doc = graph([["a"], ["b"], ["fixed"]], [["a", "b"]]);
  Object.assign(byId(doc, "b"), { x: 380, y: 96 });
  Object.assign(byId(doc, "fixed"), { x: 380, y: 0, h: 90 });
  const note = {
    ...makeNode("note", { x: 720, y: 500 }),
    id: "free-note",
    body: "動かさないメモ",
  };
  doc.nodes.push(note);
  const next = arrange(doc, ["a", "b"]);
  assert.deepEqual(byId(next, "fixed"), byId(doc, "fixed"));
  assert.deepEqual(byId(next, "free-note"), note);
  near(cy(byId(next, "a")), cy(byId(next, "b")));
  checkRoutes(next);
});
test("attached notes keep their relative position and text when a nearby connection is aligned", () => {
  let doc = graph(
    [["a"], ["b"], ["c"]],
    [
      ["a", "b"],
      ["b", "c"],
    ],
  );
  byId(doc, "a").body = "図形Aのメモ";
  byId(doc, "b").body = "図形Bのメモ";
  byId(doc, "b").y += 24;
  doc = attachNote(attachNote(doc, "a").doc, "b").doc;
  const next = arrange(doc, []);
  assert.notDeepEqual(next, doc);
  for (const note of next.nodes.filter((n) => n.attachedTo)) {
    const old = byId(doc, note.id),
      parent = byId(next, note.attachedTo),
      oldParent = byId(doc, note.attachedTo);
    near(note.x - parent.x, old.x - oldParent.x);
    near(note.y - parent.y, old.y - oldParent.y);
    assert.equal(noteContent(note, next).body, byId(doc, note.attachedTo).body);
  }
  assert.deepEqual(arrange(next, []), next);
  checkRoutes(next);
});
test("figure movement recalculates every endpoint and the exported routes", () => {
  const doc = arrange(
      graph(
        [
          ["a", "ellipse"],
          ["b", "diamond"],
          ["c", "cylinder"],
        ],
        [
          ["a", "b"],
          ["b", "c"],
        ],
      ),
      [],
    ),
    before = documentRoutes(doc),
    moved = moveNodes(doc, ["b"], 48, 120),
    routes = checkRoutes(moved),
    svg = toSvg(moved);
  for (const edge of doc.edges) {
    assert.notEqual(routes.get(edge.id).path, before.get(edge.id).path);
    assert.ok(svg.includes('d="' + routes.get(edge.id).path + '"'));
  }
});
test("routing can turn around multiple staggered obstacles", () => {
  const doc = graph(
    [["from"], ["to"], ["block1"], ["block2"], ["block3"]],
    [["from", "to"]],
  );
  Object.assign(byId(doc, "from"), { x: 0, y: 100 });
  Object.assign(byId(doc, "to"), { x: 1200, y: 100 });
  Object.assign(byId(doc, "block1"), { x: 320, y: -100, h: 420 });
  Object.assign(byId(doc, "block2"), { x: 600, y: 100, h: 400 });
  Object.assign(byId(doc, "block3"), { x: 880, y: -100, h: 420 });
  checkRoutes(doc);
  assert.ok(routeEdge(doc.edges[0], doc.nodes).points.length >= 4);
});
test("a constrained exit can route through several bends instead of crossing the walls", () => {
  const doc = graph(
    [
      ["from"],
      ["to"],
      ["top-wall"],
      ["left-wall"],
      ["bottom-wall"],
      ["right-wall"],
      ["outer-wall"],
    ],
    [["from", "to"]],
  );
  Object.assign(byId(doc, "from"), { x: 0, y: 0 });
  Object.assign(byId(doc, "to"), { x: 1000, y: 0 });
  Object.assign(byId(doc, "top-wall"), { x: -200, y: -200, w: 600, h: 100 });
  Object.assign(byId(doc, "left-wall"), { x: -200, y: -100, w: 160, h: 500 });
  Object.assign(byId(doc, "bottom-wall"), { x: -200, y: 300, w: 800, h: 100 });
  Object.assign(byId(doc, "right-wall"), { x: 280, y: -100, w: 160, h: 320 });
  Object.assign(byId(doc, "outer-wall"), { x: 600, y: 220, w: 160, h: 800 });
  const routes = checkRoutes(doc);
  assert.ok(routes.get("link-0").points.length >= 6);
});
test("branch labels occupy their own clear segments", () => {
  const doc = place(
      graph(
        [["root"], ["a"], ["b"], ["c"]],
        [
          ["root", "a", "注文データを保存する"],
          ["root", "b", "通知イベントをキューに追加する"],
          ["root", "c", "失敗した処理を再試行する"],
        ],
      ),
      [
        ["root", 40, 330],
        ["a", 780, 60],
        ["b", 780, 330],
        ["c", 780, 600],
      ],
    ),
    next = arrange(doc, []),
    routes = checkRoutes(next),
    labels = [...routes.values()].map((r) => ({
      x: r.label.x - 100,
      y: r.label.y - 22,
      w: 200,
      h: r.labelLines.length * 18 + 10,
    }));
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i],
        b = labels[j];
      assert.ok(
        a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y,
      );
    }
});
