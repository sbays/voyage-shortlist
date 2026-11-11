import { describe, expect, it } from "vitest";
import { checkAdminToken } from "./token.ts";

describe("checkAdminToken", () => {
  it("accepts only the configured token", () => {
    expect(checkAdminToken("s3cret-token", "s3cret-token")).toBe("ok");
    expect(checkAdminToken("s3cret-toke", "s3cret-token")).toBe("wrong");
    expect(checkAdminToken("", "s3cret-token")).toBe("wrong");
  });

  it("refuses everything when no token is configured", () => {
    expect(checkAdminToken("", undefined)).toBe("not_configured");
    expect(checkAdminToken("anything", "")).toBe("not_configured");
  });

  it("ignores spaces and line breaks copied around the token", () => {
    expect(checkAdminToken(" s3cret-token\n", "s3cret-token")).toBe("ok");
    expect(checkAdminToken("s3cret-token", "s3cret-token\n")).toBe("ok");
    expect(checkAdminToken("   ", "   ")).toBe("not_configured");
  });
});
