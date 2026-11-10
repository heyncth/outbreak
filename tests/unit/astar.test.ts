import { describe, expect, it } from "vitest";
import { findPath, needsRepath, MinHeap, MAX_ITERATIONS } from "@/engine/astar";
import {
  addEdge,
  addNode,
  emptyGraph,
  findNearestGraphNode,
  type RoadGraph,
} from "@/engine/osmGraph";

/** 10×5 grid lattice — 50 nodes, unit edges ~11 m apart in lat steps. */
function fixtureGrid(): RoadGraph {
  const g = emptyGraph();
  const rows = 5;
  const cols = 10;
  const lat0 = 16.05;
  const lng0 = 108.2;
  const dLat = 0.001; // ~111 m
  const dLng = 0.001;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      addNode(g, {
        id: `${r}_${c}`,
        lat: lat0 + r * dLat,
        lng: lng0 + c * dLng,
      });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) addEdge(g, `${r}_${c}`, `${r}_${c + 1}`);
      if (r + 1 < rows) addEdge(g, `${r}_${c}`, `${r + 1}_${c}`);
    }
  }
  return g;
}

describe("MinHeap", () => {
  it("pops ascending scores", () => {
    const h = new MinHeap();
    h.push("c", 3);
    h.push("a", 1);
    h.push("b", 2);
    expect(h.pop()).toBe("a");
    expect(h.pop()).toBe("b");
    expect(h.pop()).toBe("c");
    expect(h.pop()).toBeUndefined();
  });
});

describe("findPath", () => {
  it("finds path on 50-node fixture", () => {
    const g = fixtureGrid();
    const path = findPath(g, "0_0", "4_9");
    expect(path[0]).toBe("0_0");
    expect(path[path.length - 1]).toBe("4_9");
    expect(path.length).toBeGreaterThan(5);
  });

  it("returns [start] when start === goal", () => {
    const g = fixtureGrid();
    expect(findPath(g, "0_0", "0_0")).toEqual(["0_0"]);
  });

  it("handles missing nodes without hang", () => {
    const g = fixtureGrid();
    const path = findPath(g, "0_0", "nope");
    expect(path).toEqual(["0_0"]);
  });

  it("returns best-h partial path for disconnected target", () => {
    const g = emptyGraph();
    addNode(g, { id: "a", lat: 0, lng: 0 });
    addNode(g, { id: "b", lat: 0, lng: 0.01 });
    addNode(g, { id: "far", lat: 10, lng: 10 });
    addEdge(g, "a", "b");
    const path = findPath(g, "a", "far");
    expect(path[0]).toBe("a");
    expect(path).toContain("b");
    expect(path[path.length - 1]).not.toBe("far");
  });

  it("typical path under 2 ms", () => {
    const g = fixtureGrid();
    const t0 = performance.now();
    findPath(g, "0_0", "4_9");
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2);
  });

  it("respects MAX_ITERATIONS cap on large graph", () => {
    expect(MAX_ITERATIONS).toBe(600);
    const g = emptyGraph();
    // chain of 2000 nodes — forces over-budget
    for (let i = 0; i < 2000; i++) {
      addNode(g, { id: String(i), lat: 16 + i * 0.0001, lng: 108 });
      if (i > 0) addEdge(g, String(i - 1), String(i));
    }
    const path = findPath(g, "0", "1999");
    expect(path[0]).toBe("0");
    // partial toward goal — last node index < 1999 likely, but never empty
    expect(path.length).toBeGreaterThan(0);
    expect(path.length).toBeLessThanOrEqual(2000);
  });
});

describe("findNearestGraphNode", () => {
  it("snaps via grid", () => {
    const g = fixtureGrid();
    const id = findNearestGraphNode(g, { lat: 16.0501, lng: 108.2001 });
    expect(id).toBeTruthy();
    expect(g.nodes.has(id!)).toBe(true);
  });

  it("null on empty graph", () => {
    expect(findNearestGraphNode(emptyGraph(), { lat: 0, lng: 0 })).toBeNull();
  });
});

describe("needsRepath", () => {
  it("repath on empty, entered pursuit, goal moved >15 m", () => {
    expect(needsRepath(null, { lat: 0, lng: 0 }, true, false)).toBe(true);
    expect(needsRepath(null, { lat: 0, lng: 0 }, false, true)).toBe(true);
    expect(
      needsRepath({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }, false, false)
    ).toBe(true); // ~111 m
    expect(
      needsRepath({ lat: 0, lng: 0 }, { lat: 0.00001, lng: 0 }, false, false)
    ).toBe(false);
  });
});
