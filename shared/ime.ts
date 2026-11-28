// Safari can report compositionend before the final keydown, with only 229
// identifying the key that confirmed the candidate.
export function isImeKey(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}
