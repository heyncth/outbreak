import { haversineM } from "@/lib/geoUtils";
import type { RoadGraph } from "@/engine/osmGraph";

export const MAX_ITERATIONS = 600;

/** Binary min-heap keyed by f-score. */
export class MinHeap {
  private ids: string[] = [];
  private scores: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: string, score: number): void {
    this.ids.push(id);
    this.scores.push(score);
    this.bubbleUp(this.ids.length - 1);
  }

  pop(): string | undefined {
    if (this.ids.length === 0) return undefined;
    const top = this.ids[0] as string;
    const lastId = this.ids.pop() as string;
    const lastScore = this.scores.pop() as number;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.scores[0] = lastScore;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.scores[parent] as number) <= (this.scores[i] as number)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.ids.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && (this.scores[l] as number) < (this.scores[smallest] as number)) smallest = l;
      if (r < n && (this.scores[r] as number) < (this.scores[smallest] as number)) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const idA = this.ids[a] as string;
    const idB = this.ids[b] as string;
    const scA = this.scores[a] as number;
    const scB = this.scores[b] as number;
    this.ids[a] = idB;
    this.ids[b] = idA;
    this.scores[a] = scB;
    this.scores[b] = scA;
  }
}

function hCost(graph: RoadGraph, fromId: string, goalId: string): number {
  const a = graph.nodes.get(fromId);
  const b = graph.nodes.get(goalId);
  if (!a || !b) return 0;
  return haversineM(a, b);
}

/**
 * A* on road graph. Over budget → path to explored node with best h toward goal.
 * Isolated / missing endpoints → best-effort partial path (never hangs).
 */
export function findPath(
  graph: RoadGraph,
  startId: string,
  goalId: string
): string[] {
  if (startId === goalId) return [startId];
  if (!graph.nodes.has(startId) || !graph.nodes.has(goalId)) return [startId];

  const open = new MinHeap();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  let bestH = Infinity;
  let bestNodeId = startId;

  gScore.set(startId, 0);
  open.push(startId, hCost(graph, startId, goalId));

  let iterations = 0;
  while (open.size > 0 && iterations < MAX_ITERATIONS) {
    const current = open.pop()!;
    if (closed.has(current)) continue;
    closed.add(current);
    iterations++;

    const h = hCost(graph, current, goalId);
    if (h < bestH) {
      bestH = h;
      bestNodeId = current;
    }
    if (current === goalId) {
      return reconstruct(cameFrom, current);
    }

    const gCur = gScore.get(current) ?? Infinity;
    for (const edge of graph.edges.get(current) ?? []) {
      if (closed.has(edge.to)) continue;
      const tentative = gCur + edge.weight;
      const prev = gScore.get(edge.to);
      if (prev === undefined || tentative < prev) {
        gScore.set(edge.to, tentative);
        cameFrom.set(edge.to, current);
        open.push(edge.to, tentative + hCost(graph, edge.to, goalId));
      }
    }
  }

  // over budget or exhausted: best-h partial path toward goal
  return reconstruct(cameFrom, bestNodeId);
}

function reconstruct(cameFrom: Map<string, string>, nodeId: string): string[] {
  const path = [nodeId];
  let cur = nodeId;
  while (cameFrom.has(cur)) {
    cur = cameFrom.get(cur)!;
    path.push(cur);
  }
  path.reverse();
  return path;
}

/** Re-path needed when state entered pursuit, goal moved >15 m, or path empty. */
export function needsRepath(
  prevGoal: { lat: number; lng: number } | null,
  nextGoal: { lat: number; lng: number },
  pathEmpty: boolean,
  enteredPursuit: boolean
): boolean {
  if (pathEmpty || enteredPursuit) return true;
  if (!prevGoal) return true;
  return haversineM(prevGoal, nextGoal) > 15;
}
