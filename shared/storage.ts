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

// Menu commands that replace the whole document first keep one copy of it
// here, so it can be brought back even after a reload.
const previousKey = (key: string) => key + ".previous";
export function keepPrevious(key: string, raw: string) {
  try {
    localStorage.setItem(previousKey(key), raw);
    return true;
  } catch {
    return false;
  }
}
export function readPrevious(key: string) {
  try {
    return localStorage.getItem(previousKey(key));
  } catch {
    return null;
  }
}
