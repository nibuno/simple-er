import { act } from "react";
import assert from "node:assert/strict";

// Dispatch a complete composition sequence in the order used by each engine.
export async function imeKey(input, key, engine, modifiers = {}) {
  const { CompositionEvent, KeyboardEvent } = input.ownerDocument.defaultView;
  const compose = (type) =>
    input.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
  await act(() => compose("compositionstart"));
  if (engine === "Safari") await act(() => compose("compositionend"));
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    isComposing: engine === "Chrome",
    keyCode: engine === "Safari" ? 229 : key === "Escape" ? 27 : 13,
    ...modifiers,
  });
  await act(() => {
    assert.equal(
      input.dispatchEvent(event),
      true,
      "the IME must receive its key",
    );
  });
  if (engine === "Chrome") await act(() => compose("compositionend"));
}
