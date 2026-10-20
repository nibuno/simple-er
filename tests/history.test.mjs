import { test } from "node:test";
import assert from "node:assert/strict";
import { historyReducer } from "../src/history.ts";
import { initial as diagram } from "../src/initial.ts";
import { documentFromDiagram } from "../src/model.ts";
const initial = documentFromDiagram(diagram);
test("many drag previews commit as one undo step, cancel creates no history", () => {
  const origin = { present: initial, past: [], future: [] };
  let state = origin;
  for (let i = 1; i <= 20; i++) {
    const next = structuredClone(initial);
    next.presentation.tables[0].x += i;
    state = historyReducer(state, { type: "preview", next });
  }
  assert.equal(state.past.length, 0);
  const committed = historyReducer(state, {
    type: "commit",
    next: state.present,
    before: initial,
  });
  assert.equal(committed.past.length, 1);
  assert.deepEqual(
    historyReducer(committed, { type: "undo" }).present,
    initial,
  );
  assert.deepEqual(
    historyReducer(state, { type: "preview", next: initial }),
    origin,
  );
});
test("history is bounded and a new edit clears the redo branch", () => {
  let state = { present: initial, past: [], future: [] };
  for (let i = 1; i <= 70; i++) {
    const next = structuredClone(initial);
    next.presentation.tables[0].x += i;
    state = historyReducer(state, { type: "commit", next });
  }
  assert.equal(state.past.length, 60);
  state = historyReducer(state, { type: "undo" });
  assert.equal(state.future.length, 1);
  state = historyReducer(state, { type: "commit", next: initial });
  assert.equal(state.future.length, 0);
});
