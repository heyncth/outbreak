import { describe, expect, it } from "vitest";
import { parseTs } from "@/lib/api";

describe("parseTs", () => {
  it("parses ISO Z", () => {
    expect(parseTs("2026-11-09T23:35:43.829927Z")).toBeGreaterThan(0);
  });
  it("parses postgres space + +00", () => {
    expect(parseTs("2026-11-09 23:35:43.829927+00")).toBeGreaterThan(0);
  });
  it("parses +00:00", () => {
    expect(parseTs("2026-11-09T23:35:43.829927+00:00")).toBeGreaterThan(0);
  });
  it("null on garbage", () => {
    expect(parseTs("not-a-date")).toBeNull();
    expect(parseTs(null)).toBeNull();
  });
});
