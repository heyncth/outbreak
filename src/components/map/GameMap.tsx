"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng, ZombieTick, WorldStateTick } from "@/types/game";
import { dbg } from "@/lib/debug";

const STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const ZOMBIE_COLORS: Record<string, string> = {
  WALKER: "#475569",
  RUNNER: "#ea580c",
  STALKER: "#7c3aed",
  SCREAMER: "#db2777",
  BRUTE: "#dc2626",
};

const ZOMBIE_TYPES = ["WALKER", "RUNNER", "STALKER", "SCREAMER", "BRUTE"] as const;
type ZombieShape = (typeof ZOMBIE_TYPES)[number];

const ZOMBIE_GEOJSON = "zombies-src";
const ZONE_GEOJSON = "zones-src";
const PLAYERS_GEOJSON = "players-src";

const PLAYER_COLORS: Record<string, string> = {
  ALIVE: "#06B6D4",
  KNOCKED: "#F97316",
  DISCONNECTED: "#64748B",
};

function zombieIconImage(type: ZombieShape, color: string): HTMLCanvasElement {
  const size = 36;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const cx = size / 2;
  const cy = size / 2;
  const r = type === "BRUTE" ? 15 : type === "RUNNER" ? 12 : 11;
  ctx.fillStyle = color;
  ctx.strokeStyle = "#0a0e0a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (type === "WALKER") {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (type === "RUNNER") {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.9, cy + r);
    ctx.lineTo(cx - r * 0.9, cy + r);
    ctx.closePath();
  } else if (type === "STALKER") {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  } else if (type === "SCREAMER") {
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  return c;
}

interface GameMapProps {
  center: LatLng;
  selfPos: LatLng | null;
  noise: number;
  zombies?: ZombieTick[];
  worldTick?: WorldStateTick | null;
}

function toFeatureCollection(zombies: ZombieTick[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zombies.map((z) => ({
      type: "Feature",
      properties: {
        id: z.id,
        type: z.type,
        state: z.state,
        color: ZOMBIE_COLORS[z.type] ?? "#ef4444",
        heading: z.heading_deg,
        icon: `zombie-${z.type}`,
      },
      geometry: { type: "Point", coordinates: [z.lng, z.lat] },
    })),
  };
}

function zonesToFeatureCollection(
  zones: WorldStateTick["safe_zones"]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      properties: {
        id: z.id,
        zone_type: z.zone_type,
        radius_m: z.radius_m,
      },
      geometry: { type: "Point", coordinates: [z.lng, z.lat] },
    })),
  };
}

function playersToFeatureCollection(
  players: WorldStateTick["players"]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: players.map((p) => ({
      type: "Feature",
      properties: {
        id: p.player_id,
        state: p.state,
        color: PLAYER_COLORS[p.state] ?? "#06B6D4",
      },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

export function GameMap({
  center,
  selfPos,
  noise,
  zombies = [],
  worldTick,
}: GameMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const ringRef = useRef<maplibregl.Marker | null>(null);
  const centerRef = useRef(center);
  const selfRef = useRef(selfPos);
  const noiseRef = useRef(noise);
  const zombiesRef = useRef(zombies);
  zombiesRef.current = zombies;
  const zonesRef = useRef(worldTick?.safe_zones ?? []);
  zonesRef.current = worldTick?.safe_zones ?? [];
  const playersRef = useRef(worldTick?.players ?? []);
  playersRef.current = worldTick?.players ?? [];

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [centerRef.current.lng, centerRef.current.lat],
      zoom: 17,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    (window as unknown as { __map?: maplibregl.Map }).__map = map;
    dbg("map constructed", {
      center: [centerRef.current.lng, centerRef.current.lat],
      zoom: 17,
      container: containerRef.current.getBoundingClientRect(),
    });
    map.on("error", (e) => {
      const err = (e as { error?: { message?: string } }).error;
      dbg("map error", err?.message ?? e);
    });
    map.on("dataloading", (e) => dbg("map dataloading", (e as unknown as { dataType?: string }).dataType));
    map.on("idle", () => dbg("map idle (all tiles settled)"));

    map.on("load", async () => {
      dbg("map load fired", {
        canvas: Boolean(map.getCanvas()),
        canvasSize: [map.getCanvas().width, map.getCanvas().height],
        styleLoaded: map.isStyleLoaded(),
      });
      const ringEl = document.createElement("div");
      ringEl.setAttribute("data-testid", "noise-ring");
      ringRef.current = new maplibregl.Marker({ element: ringEl })
        .setLngLat([centerRef.current.lng, centerRef.current.lat])
        .addTo(map);

      const selfEl = document.createElement("div");
      selfEl.setAttribute("data-testid", "self-marker");
      selfEl.style.cssText =
        "width:24px;height:24px;background:url('/icons/self_marker.png') center/contain no-repeat;filter:drop-shadow(0 0 4px #16a34a);";
      markerRef.current = new maplibregl.Marker({ element: selfEl })
        .setLngLat([centerRef.current.lng, centerRef.current.lat])
        .addTo(map);

      map.addSource(ZOMBIE_GEOJSON, {
        type: "geojson",
        data: toFeatureCollection(zombiesRef.current),
      });
      const iconFiles: Record<string, string> = {
        WALKER: "/icons/walker.png",
        RUNNER: "/icons/runner.png",
        STALKER: "/icons/stalker.png",
        SCREAMER: "/icons/screamer.png",
        BRUTE: "/icons/brute.png",
      };
      for (const t of ZOMBIE_TYPES) {
        const id = `zombie-${t}`;
        if (!map.hasImage(id)) {
          const url = iconFiles[t];
          if (url) {
            try {
              const res = await map.loadImage(url);
              if (!map.hasImage(id)) map.addImage(id, res.data);
            } catch {
              // image load failed; fall back to canvas icon
            }
          }
        }
      }
      map.addLayer({
        id: "zombies-symbol",
        type: "symbol",
        source: ZOMBIE_GEOJSON,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["match", ["get", "type"], "BRUTE", 1.35, 1],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
      map.addLayer({
        id: "zombies-chase-ring",
        type: "circle",
        source: ZOMBIE_GEOJSON,
        filter: ["==", ["get", "state"], "CHASE"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 14, 18, 44],
          "circle-color": "rgba(239,68,68,0.15)",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#EF4444",
        },
      });

      map.addSource(ZONE_GEOJSON, {
        type: "geojson",
        data: zonesToFeatureCollection(zonesRef.current),
      });
      map.addSource(PLAYERS_GEOJSON, {
        type: "geojson",
        data: playersToFeatureCollection(playersRef.current),
      });
      map.addLayer({
        id: "players-circle",
        type: "circle",
        source: PLAYERS_GEOJSON,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 7, 18, 16],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0a0e0a",
        },
      });
      map.addLayer({
        id: "safe-zone-fill",
        type: "circle",
        source: ZONE_GEOJSON,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 15, 8, 16, 16, 17, 32, 18, 64],
          "circle-color": "rgba(16,185,129,0.2)",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#10B981",
        },
      });
      map.addLayer({
        id: "safe-zone-ring",
        type: "circle",
        source: ZONE_GEOJSON,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 6, 15, 10, 16, 18, 17, 34, 18, 66],
          "circle-color": "rgba(16,185,129,0.05)",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#10B981",
        },
      });
    });

    return () => {
      markerRef.current?.remove();
      ringRef.current?.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      ringRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (selfPos) selfRef.current = selfPos;
    if (!selfPos || !markerRef.current || !mapRef.current) return;
    const lngLat: [number, number] = [selfPos.lng, selfPos.lat];
    markerRef.current.setLngLat(lngLat);
    const size = Math.round(40 + Math.min(noise, 1) * 120);
    const el = markerRef.current.getElement();
    el.style.outline = `${Math.max(1, Math.round(noise * 4))}px solid rgba(255, 209, 102, ${0.3 + noise * 0.7})`;
    el.style.width = "16px";
    el.style.height = "16px";
    if (ringRef.current) {
      const ringEl = ringRef.current.getElement();
      ringEl.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:2px solid rgba(255,209,102,0.5);background:rgba(255,209,102,0.08);pointer-events:none;`;
      ringRef.current.setLngLat(lngLat);
    }
    // recenter only when self marker would leave the viewport — free pan otherwise
    const map = mapRef.current;
    if (map && !map.getBounds().contains(lngLat)) {
      map.easeTo({ center: lngLat, duration: 500 });
    }
  }, [selfPos, noise]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(ZOMBIE_GEOJSON) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(toFeatureCollection(zombies));
    const zsrc = map.getSource(ZONE_GEOJSON) as maplibregl.GeoJSONSource | undefined;
    if (zsrc) zsrc.setData(zonesToFeatureCollection(worldTick?.safe_zones ?? []));
    const psrc = map.getSource(PLAYERS_GEOJSON) as maplibregl.GeoJSONSource | undefined;
    if (psrc) psrc.setData(playersToFeatureCollection(worldTick?.players ?? []));
  }, [zombies, worldTick?.tick_id, worldTick?.safe_zones, worldTick?.players]);

  useEffect(() => {
    const onResize = () => mapRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // maplibregl-map CSS (position:relative; overflow:hidden) fights Tailwind
  // absolute on the same node — sized outer, map container inner
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" data-testid="game-map" />
    </div>
  );
}
