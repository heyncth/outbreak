import { describe, expect, it, vi } from "vitest";
import { findZone, buildGraphFromOverpass, loadRoadGraph } from "@/engine/osmGraph";

describe("findZone", () => {
  it("returns danang-center inside its bbox", () => {
    expect(findZone({ lat: 16.054407, lng: 108.202167 })).toBe("danang-center");
  });

  it("returns null outside any zone", () => {
    expect(findZone({ lat: 21.0285, lng: 105.8542 })).toBeNull();
  });
});

describe("buildGraphFromOverpass", () => {
  it("builds nodes and edges from zone data", () => {
    const g = buildGraphFromOverpass({
      elements: [
        { type: "node", id: 1, lat: 16.05, lon: 108.2 },
        { type: "node", id: 2, lat: 16.051, lon: 108.2 },
        { type: "way", id: 10, nodes: [1, 2] },
      ],
    });
    expect(g.nodes.size).toBe(2);
    expect(g.edges.get("1")).toHaveLength(1);
    expect(g.edges.get("2")).toHaveLength(1);
  });
});

describe("loadRoadGraph — OSM API fallback", () => {
  it("builds graph from OSM XML when no bundled zone", async () => {
    const xml =
      '<osm version="0.6">' +
      '<node id="1" lat="21.03" lon="105.85"/>' +
      '<node id="2" lat="21.031" lon="105.85"/>' +
      '<way id="9"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>' +
      '<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="building"/></way>' +
      "</osm>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => xml })
    );
    try {
      const r = await loadRoadGraph({ lat: 21.0285, lng: 105.8542 });
      expect(r.mode).toBe("GRAPH_ASTAR");
      expect(r.graph?.nodes.size).toBe(2);
      expect(r.graph?.edges.get("1")).toHaveLength(1); // building way filtered out
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
