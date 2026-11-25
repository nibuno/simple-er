// Both editors stop automatic writes when another tab changes their document.
export function watchStorage(
  key: string,
  current: () => string | null,
  onConflict: (raw: string | null) => void,
) {
  const changed = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (
      (event.key === key || event.key === null) &&
      event.newValue !== current()
    )
      onConflict(event.newValue);
  };
  window.addEventListener("storage", changed);
  return () => window.removeEventListener("storage", changed);
}
