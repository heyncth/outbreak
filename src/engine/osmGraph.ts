import { haversineM, toRadians } from "@/lib/geoUtils";
import { dbg } from "@/lib/debug";
import type { LatLng } from "@/types/game";
import zoneManifest from "../../public/graphs/manifest.json";

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

export const GRID_SIZE_M = 100;

const OSM_BBOX_RADIUS_M = 1200;
const OSM_API_TIMEOUT_MS = 8000;
const OSM_HIGHWAY_RE =
  /^(footway|pedestrian|residential|living_street|tertiary|secondary|primary|service|path)$/;

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

interface ZoneNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface ZoneWay {
  type: "way";
  id: number;
  nodes: number[];
}

interface ZoneData {
  elements: Array<ZoneNode | ZoneWay>;
}

interface Zone {
  name: string;
  /** [south, west, north, east] */
  bbox: [number, number, number, number];
}

export function findZone(p: LatLng): string | null {
  const zones = zoneManifest.zones as Zone[];
  for (const z of zones) {
    const [s, w, n, e] = z.bbox;
    if (p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e) return z.name;
  }
  return null;
}

export function buildGraphFromOverpass(data: ZoneData): RoadGraph {
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

/** shortcut: OSM XML is machine-generated (fixed attr order k then v) — regex scan instead of DOMParser; swap for a real parser if format drifts */
function parseOsmXml(xml: string): RoadGraph {
  const g = emptyGraph();
  for (const m of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attrs = m[1] ?? "";
    const id = /\bid="(\d+)"/.exec(attrs)?.[1];
    const lat = /\blat="([^"]+)"/.exec(attrs)?.[1];
    const lon = /\blon="([^"]+)"/.exec(attrs)?.[1];
    if (id && lat && lon) addNode(g, { id, lat: Number(lat), lng: Number(lon) });
  }
  for (const m of xml.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = m[1] ?? "";
    const hw = /<tag\b[^>]*\bk="highway"[^>]*\bv="([^"]+)"/.exec(body)?.[1];
    if (!hw || !OSM_HIGHWAY_RE.test(hw)) continue;
    const refs = [...body.matchAll(/<nd\b[^>]*\bref="(\d+)"/g)].map((r) => r[1]);
    for (let i = 0; i < refs.length - 1; i++) {
      const a = refs[i];
      const b = refs[i + 1];
      if (!a || !b) continue;
      addEdge(g, a, b);
      addEdge(g, b, a);
    }
  }
  return g;
}

async function fetchOsmApiGraph(center: LatLng): Promise<RoadGraph | null> {
  const dLat = OSM_BBOX_RADIUS_M / 111_320;
  const dLng =
    OSM_BBOX_RADIUS_M / Math.max(1, 111_320 * Math.cos(toRadians(center.lat)));
  // OSM bbox order: minLon,minLat,maxLon,maxLat
  const bbox = `${center.lng - dLng},${center.lat - dLat},${center.lng + dLng},${center.lat + dLat}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OSM_API_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OSM_API ${res.status}`);
    const g = parseOsmXml(await res.text());
    if (g.nodes.size === 0) return null;
    dbg("osm api graph", { nodes: g.nodes.size, edges: g.edges.size });
    return g;
  } finally {
    clearTimeout(timer);
  }
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
 * Graph sources in order: sessionStorage cache → bundled zone → OSM API bbox
 * (real-time extract, any location) → DIRECT_VECTOR_FALLBACK.
 */
export async function loadRoadGraph(center: LatLng): Promise<GraphResult> {
  const cached = readCache(center.lat, center.lng);
  if (cached) return cached;

  const t0 = Date.now();
  const zone = findZone(center);
  if (zone) {
    try {
      const res = await fetch(`/graphs/${zone}.json`);
      if (!res.ok) throw new Error(`zone ${res.status}`);
      const data = (await res.json()) as ZoneData;
      const graph = buildGraphFromOverpass(data);
      if (graph.nodes.size === 0) throw new Error("zone graph empty");
      const result: GraphResult = {
        graph,
        mode: "GRAPH_ASTAR",
        build_ms: Date.now() - t0,
      };
      writeCache(center.lat, center.lng, result);
      dbg("zone graph loaded", { zone, nodes: graph.nodes.size });
      return result;
    } catch (e) {
      dbg("zone load fail", zone, e instanceof Error ? e.message : String(e));
    }
  } else {
    dbg("no bundled zone — trying OSM API");
  }

  // real-time extract by bbox: any Vietnam location, no server
  try {
    const g = await fetchOsmApiGraph(center);
    if (g) {
      const result: GraphResult = {
        graph: g,
        mode: "GRAPH_ASTAR",
        build_ms: Date.now() - t0,
      };
      writeCache(center.lat, center.lng, result);
      return result;
    }
    dbg("osm api empty graph");
  } catch (e) {
    dbg("osm api fail", e instanceof Error ? e.message : String(e));
  }

  return { graph: null, mode: "DIRECT_VECTOR_FALLBACK", build_ms: Date.now() - t0 };
}
