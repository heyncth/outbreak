import { haversineM, toRadians } from "@/lib/geoUtils";
import { dbg } from "@/lib/debug";
import type { LatLng } from "@/types/game";

export type PathfindingMode = "GRAPH_ASTAR" | "DIRECT_VECTOR_FALLBACK";

export interface GraphNode {
  id: string;
  lat: number;
  lng: number;
}

export interface GraphEdge {
  to: string;
  weight: number;
}

export interface RoadGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge[]>;
  /** 100 m grid: cellKey → node ids */
  grid: Map<string, string[]>;
}

export interface GraphResult {
  graph: RoadGraph | null;
  mode: PathfindingMode;
  build_ms: number;
}

export const OVERPASS_RADIUS_M = 1200;
export const OVERPASS_TIMEOUT_MS = 8000;
export const GRAPH_TOTAL_BUDGET_MS = 10_000;
export const GRID_SIZE_M = 100;

const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const HIGHWAY_RE =
  "^(footway|pedestrian|residential|living_street|tertiary|secondary|primary|service|path)$";

export function gridKey(lat: number, lng: number): string {
  const cellLat = GRID_SIZE_M / 111_320;
  const cellLng = GRID_SIZE_M / Math.max(1, 111_320 * Math.cos(toRadians(lat)));
  return `${Math.floor(lat / cellLat)}:${Math.floor(lng / cellLng)}`;
}

function parseGridKey(key: string): { row: number; col: number } {
  const parts = key.split(":");
  const row = Number(parts[0]);
  const col = Number(parts[1]);
  return { row, col };
}

export function emptyGraph(): RoadGraph {
  return { nodes: new Map(), edges: new Map(), grid: new Map() };
}

export function addNode(g: RoadGraph, node: GraphNode): void {
  if (g.nodes.has(node.id)) return;
  g.nodes.set(node.id, node);
  const key = gridKey(node.lat, node.lng);
  const list = g.grid.get(key);
  if (list) list.push(node.id);
  else g.grid.set(key, [node.id]);
}

export function addEdge(g: RoadGraph, from: string, to: string, weight?: number): void {
  const a = g.nodes.get(from);
  const b = g.nodes.get(to);
  if (!a || !b) return;
  const w = weight ?? haversineM(a, b);
  const list = g.edges.get(from) ?? [];
  if (!list.some((e) => e.to === to)) {
    list.push({ to, weight: w });
    g.edges.set(from, list);
  }
}

/** Nearest node via 100 m grid neighborhood (3×3 cells), then full scan fallback. */
export function findNearestGraphNode(g: RoadGraph, p: LatLng): string | null {
  if (g.nodes.size === 0) return null;
  const key = gridKey(p.lat, p.lng);
  const { row, col } = parseGridKey(key);
  let best: string | null = null;
  let bestD = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const ids = g.grid.get(`${row + dr}:${col + dc}`);
      if (!ids) continue;
      for (const id of ids) {
        const n = g.nodes.get(id);
        if (!n) continue;
        const d = haversineM(p, n);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
    }
  }
  if (best) return best;
  for (const n of g.nodes.values()) {
    const d = haversineM(p, n);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
}

interface OverpassOut {
  elements: Array<OverpassNode | OverpassWay>;
}

function buildQuery(lat: number, lng: number): string {
  return `[out:json][timeout:15];
(
way["highway"~"${HIGHWAY_RE}"]
  (around:${OVERPASS_RADIUS_M}, ${lat}, ${lng});
);
out body;
>;
out skel qt;`;
}

async function fetchEndpoint(
  endpoint: string,
  query: string,
  timeoutMs: number
): Promise<OverpassOut> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    return (await res.json()) as OverpassOut;
  } finally {
    clearTimeout(timer);
  }
}

export function buildGraphFromOverpass(data: OverpassOut): RoadGraph {
  const g = emptyGraph();
  for (const el of data.elements) {
    if (el.type === "node") {
      addNode(g, { id: String(el.id), lat: el.lat, lng: el.lon });
    }
  }
  for (const el of data.elements) {
    if (el.type !== "way") continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = String(el.nodes[i]);
      const b = String(el.nodes[i + 1]);
      addEdge(g, a, b);
      addEdge(g, b, a);
    }
  }
  return g;
}

function cacheKey(lat: number, lng: number): string {
  return `outbreak_graph_${lat.toFixed(3)}_${lng.toFixed(3)}`;
}

function readCache(lat: number, lng: number): GraphResult | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(lat, lng));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      mode: PathfindingMode;
      build_ms: number;
      nodes: GraphNode[];
      edges: Array<[string, GraphEdge[]]>;
    };
    const g = emptyGraph();
    for (const n of parsed.nodes) addNode(g, n);
    for (const [from, list] of parsed.edges) g.edges.set(from, list);
    if (g.nodes.size === 0) return null;
    return { graph: g, mode: parsed.mode, build_ms: parsed.build_ms };
  } catch {
    return null;
  }
}

function writeCache(lat: number, lng: number, result: GraphResult): void {
  try {
    if (!result.graph) return;
    sessionStorage.setItem(
      cacheKey(lat, lng),
      JSON.stringify({
        mode: result.mode,
        build_ms: result.build_ms,
        nodes: [...result.graph.nodes.values()],
        edges: [...result.graph.edges.entries()],
      })
    );
  } catch {
    /* quota — skip cache */
  }
}

/**
 * Fetch OSM walkable graph once per match. Primary → mirror once;
 * total ≤ 10 s else DIRECT_VECTOR_FALLBACK.
 */
export async function loadRoadGraph(center: LatLng): Promise<GraphResult> {
  const cached = readCache(center.lat, center.lng);
  if (cached) return cached;

  const t0 = Date.now();
  const endpoints = process.env.NEXT_PUBLIC_OVERPASS_URL
    ? [process.env.NEXT_PUBLIC_OVERPASS_URL, ...DEFAULT_ENDPOINTS]
    : DEFAULT_ENDPOINTS;
  const query = buildQuery(center.lat, center.lng);

  for (const endpoint of endpoints) {
    const elapsed = Date.now() - t0;
    const remaining = GRAPH_TOTAL_BUDGET_MS - elapsed;
    if (remaining <= 0) break;
    const timeout = Math.min(OVERPASS_TIMEOUT_MS, remaining);
    try {
      const data = await fetchEndpoint(endpoint, query, timeout);
      const graph = buildGraphFromOverpass(data);
      if (graph.nodes.size > 0) {
        const result: GraphResult = {
          graph,
          mode: "GRAPH_ASTAR",
          build_ms: Date.now() - t0,
        };
        writeCache(center.lat, center.lng, result);
        return result;
      }
      dbg("overpass empty", endpoint);
    } catch (e) {
      dbg("overpass fail", endpoint, e instanceof Error ? e.message : String(e));
    }
  }

  dbg("overpass exhausted — falling back to DIRECT_VECTOR", { budget_ms: GRAPH_TOTAL_BUDGET_MS });
  return { graph: null, mode: "DIRECT_VECTOR_FALLBACK", build_ms: Date.now() - t0 };
}
