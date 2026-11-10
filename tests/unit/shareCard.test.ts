import { describe, expect, it } from "vitest";
import { projectTrack } from "@/lib/shareCard";

describe("projectTrack", () => {
  it("returns empty for empty track", () => {
    expect(projectTrack([], 1080, 1080)).toEqual([]);
  });

  it("maps a single point to center", () => {
    const pts = projectTrack([{ lat: 16, lng: 108 }], 1080, 1080, 80);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.x).toBeCloseTo(540, 5);
    expect(pts[0]?.y).toBeCloseTo(540, 5);
  });

  it("keeps two points inside canvas with padding", () => {
    const pts = projectTrack(
      [
        { lat: 16.05, lng: 108.2 },
        { lat: 16.06, lng: 108.21 },
      ],
      1080,
      1080,
      80
    );
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1080);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1080);
    }
    // north point should be above south point on canvas
    expect(pts[0]!.y).toBeGreaterThan(pts[1]!.y);
  });
});
