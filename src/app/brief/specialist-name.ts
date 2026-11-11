// "Your name" for the email sign-off, kept in this browser only. Storage can
// be missing or throw (private windows, blocked site data), so every access
// is guarded and the form works without it.

export const NAME_KEY = "voyage-shortlist:specialist-name";

type NameStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): NameStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readName(store: NameStorage | null = storage()): string {
  try {
    return store?.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeName(name: string, store: NameStorage | null = storage()): void {
  try {
    if (name.trim()) store?.setItem(NAME_KEY, name);
    else store?.removeItem(NAME_KEY);
  } catch {
    // Not remembered; the field still works for this visit.
  }
}

/** For useSyncExternalStore: tells a reader when another tab changes the name. */
export function subscribeName(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: StorageEvent) => {
    if (event.key === NAME_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
