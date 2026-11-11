import { describe, expect, it } from "vitest";
import { importObjectName, storeImportFile } from "./storage.ts";

describe("importObjectName", () => {
  const now = new Date("2026-11-11T12:34:56.789Z");

  it("prefixes a timestamp and keeps a safe file name", () => {
    expect(importObjectName("Petrel feed (Nov).csv", now)).toBe(
      "imports/2026-11-11T12-34-56-789Z-Petrel-feed-Nov.csv",
    );
  });

  it("can't escape the imports folder", () => {
    expect(importObjectName("../../etc/passwd", now)).toBe("imports/2026-11-11T12-34-56-789Z-etc-passwd.csv");
    expect(importObjectName("...", now)).toBe("imports/2026-11-11T12-34-56-789Z-upload.csv");
  });
});

describe("storeImportFile", () => {
  it("stores nothing when no bucket is configured", async () => {
    const previous = process.env.IMPORT_BUCKET;
    delete process.env.IMPORT_BUCKET;
    try {
      expect(await storeImportFile("a.csv", "x")).toBeNull();
    } finally {
      if (previous !== undefined) process.env.IMPORT_BUCKET = previous;
    }
  });
});
