import test from "node:test";
import assert from "node:assert/strict";
import { compareDiagrams } from "../canvas/src/variants.ts";
import { sampleDocument } from "../canvas/src/model.ts";

test("diff uses figure and wire IDs, covers memo state, and ignores JSON property order", () => {
  const left = sampleDocument(),
    right = structuredClone(left);
  const [changed, removed, stable] = right.nodes;
  changed.memoStatus = "decided";
  right.nodes[1] = { ...removed, id: "added-box" };
  right.nodes[2] = Object.fromEntries(Object.entries(stable).reverse());
  const [changedWire, removedWire, stableWire] = right.edges;
  changedWire.dashed = !changedWire.dashed;
  right.edges[1] = { ...removedWire, id: "added-wire" };
  stableWire.arrowheads = "end";
  const diff = compareDiagrams(left, right);
  assert.deepEqual(
    diff.nodes,
    new Map([
      [changed.id, "changed"],
      [removed.id, "removed"],
      ["added-box", "added"],
    ]),
  );
  assert.deepEqual(
    diff.edges,
    new Map([
      [changedWire.id, "changed"],
      [removedWire.id, "removed"],
      ["added-wire", "added"],
    ]),
  );
});

test("図形の ER リンクは図の複製で一致し、リンク先の変更は差分になる", () => {
  const doc = sampleDocument();
  doc.nodes[0].erLink = {
    store: "store",
    key: "er-sketch.local.v1",
    id: "first",
  };
  const other = structuredClone(doc);
  assert.equal(compareDiagrams(doc, other).nodes.size, 0);
  other.nodes[0].erLink.id = "second";
  assert.equal(
    compareDiagrams(doc, other).nodes.get(doc.nodes[0].id),
    "changed",
  );
});
