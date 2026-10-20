import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import assert from "node:assert/strict";
import {
  current,
  avoid,
  elkLayout,
  avoidSession,
  settings,
  wasmLoadMs,
} from "./engines.mjs";
import { cases, editsBase, obstacle } from "./cases.mjs";
import { measure, signature, changedRoutes } from "./metrics.mjs";
import { renderHtml } from "./render.mjs";
const repetitions = 5,
  data = [];
async function benchmark(fn) {
  const first = await fn(),
    times = [];
  let deterministic = true;
  for (let i = 0; i < repetitions; i++) {
    const t = performance.now();
    const next = await fn();
    times.push(performance.now() - t);
    deterministic &&= signature(next) === signature(first);
  }
  times.sort((a, b) => a - b);
  return {
    ...first,
    metrics: measure(first),
    timingMs: {
      median: +times[2].toFixed(3),
      min: +times[0].toFixed(3),
      max: +times[4].toFixed(3),
    },
    deterministic,
  };
}
for (const c of cases) {
  const baseline = await benchmark(() => current(c.diagram));
  const routed = await benchmark(() => avoid(baseline.diagram));
  const elk = await benchmark(() => elkLayout(c.diagram));
  const hybrid = await benchmark(() => avoid(elk.diagram));
  const reverse = (d) => ({
    ...structuredClone(d),
    tables: [...d.tables].reverse(),
    edges: [...d.edges].reverse(),
  });
  for (const [name, expected, actual] of [
    ["current", baseline, current(reverse(c.diagram))],
    ["avoid", routed, avoid(reverse(baseline.diagram))],
    ["elk", elk, await elkLayout(reverse(c.diagram))],
    ["hybrid", hybrid, avoid(reverse(elk.diagram))],
  ]) {
    expected.inputOrderIndependent = signature(expected) === signature(actual);
    assert.equal(
      expected.inputOrderIndependent,
      true,
      `${c.id}/${name}: input order`,
    );
  }
  data.push({
    ...c,
    results: { current: baseline, avoid: routed, elk, hybrid },
  });
  console.log(
    c.id,
    Object.fromEntries(
      Object.entries(data.at(-1).results).map(([k, r]) => [
        k,
        {
          ...r.metrics,
          bounds: undefined,
          ms: r.timingMs.median,
          deterministic: r.deterministic,
        },
      ]),
    ),
  );
}
// Incremental edits use one live libavoid router, not a fresh instance per edit.
const session = avoidSession(editsBase);
let before = session.result();
let currentBefore = current(editsBase, false);
const stages = [
  {
    id: "before",
    name: "追加前",
    diagram: structuredClone(editsBase),
    avoid: before,
    current: currentBefore,
  },
];
let t = performance.now();
let added = session.addObstacle(obstacle);
const addMs = performance.now() - t;
let d = structuredClone(editsBase);
d.tables.push(structuredClone(obstacle));
let cAdded = current(d, false);
stages.push({
  id: "added",
  name: "途中にテーブル追加",
  diagram: d,
  avoid: added,
  current: cAdded,
});
t = performance.now();
let moved = session.moveTable(obstacle.id, 0, 580);
const moveMs = performance.now() - t;
const dm = structuredClone(d);
dm.tables.find((t) => t.id === obstacle.id).y += 580;
stages.push({
  id: "moved",
  name: "障害物を下へ移動",
  diagram: dm,
  avoid: moved,
  current: current(dm, false),
});
session.close();
const editMeasurements = {
  libavoidAddMs: addMs,
  libavoidMoveMs: moveMs,
  changes: stages.slice(1).map((stage, i) => ({
    stage: stage.id,
    current: changedRoutes(stages[i].current, stage.current),
    avoid: changedRoutes(stages[i].avoid, stage.avoid),
  })),
};
for (const s of stages)
  data.push({
    id: s.id,
    name: s.name,
    note: "配置は固定。途中への追加・移動で線がどう変わるか。libavoidは同じルーターへの差分更新。",
    diagram: s.diagram,
    results: Object.fromEntries(
      ["current", "avoid"].map((k) => [
        k,
        { ...s[k], metrics: measure(s[k]), incremental: true },
      ]),
    ),
  });
const fingerprintFiles = [
  "src/geometry.ts",
  "src/layout.ts",
  "src/model.ts",
  "src/relationships.ts",
  "src/types.ts",
  "tests/layout-fixtures.mjs",
];
const metadata = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0].model,
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceSha256: Object.fromEntries(
    fingerprintFiles.map((p) => [
      p,
      createHash("sha256")
        .update(readFileSync(new URL("../../" + p, import.meta.url)))
        .digest("hex"),
    ]),
  ),
  engines: { elkjs: "0.12.0", "libavoid-js": "0.5.0-beta.5" },
  settings,
  repetitions,
  wasmLoadMs,
  editMeasurements,
};
// Checkpoint constraints affect libavoid's global nudging; record the alternative too.
metadata.unguardedSensitivity = cases.map((c) => {
  const session = avoidSession(current(c.diagram).diagram, false);
  try {
    return { case: c.id, metrics: measure(session.result()) };
  } finally {
    session.close();
  }
});
for (const c of data)
  for (const [name, r] of Object.entries(c.results)) {
    for (const k of [
      "penetrations",
      "nonOrthogonal",
      "endpointErrors",
      "shortStubs",
      "tableOverlaps",
      "labelTableCollisions",
      "labelLabelCollisions",
    ])
      assert.equal(r.metrics[k], 0, `${c.id}/${name}: ${k}`);
    if (r.deterministic !== undefined)
      assert.equal(r.deterministic, true, `${c.id}/${name}: repeatability`);
  }
const result = { metadata, cases: data };
const output = new URL("./output/", import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(
  new URL("results.json", output),
  JSON.stringify(
    result,
    (k, v) => (v instanceof Map ? Object.fromEntries(v) : v),
    2,
  ) + "\n",
);
writeFileSync(new URL("comparison.html", output), renderHtml(result));
if (process.argv.includes("--serve-copy"))
  writeFileSync(
    new URL("../../dist/comparison.html", import.meta.url),
    renderHtml(result),
  );
console.log("Generated output/comparison.html and output/results.json");
