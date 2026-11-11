import { describe, expect, it } from "vitest";
import { NAME_KEY, readName, writeName } from "./specialist-name";

function memoryStore() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("specialist name storage", () => {
  it("remembers a name and forgets a blank one", () => {
    const store = memoryStore();
    writeName("Ana", store);
    expect(readName(store)).toBe("Ana");
    writeName("  ", store);
    expect(store.items.has(NAME_KEY)).toBe(false);
  });

  it("works without storage and when storage throws", () => {
    expect(readName(null)).toBe("");
    expect(readName(throwing)).toBe("");
    expect(() => writeName("Ana", throwing)).not.toThrow();
  });
});
