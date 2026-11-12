// One-time: cut Geofabrik PBF to a small Overpass-shaped zone JSON.
// Usage: node cut.js <lat> <lng> <radius_m> <outfile>
const fs = require("fs");
const osmread = require("osm-read");

const [, , latS, lngS, radS, out] = process.argv;
const LAT = Number(latS);
const LNG = Number(lngS);
const RAD = Number(radS);
if (!LAT || !LNG || !RAD || !out) {
  console.error("usage: node cut.js <lat> <lng> <radius_m> <outfile>");
  process.exit(1);
}

const HIGHWAY_RE =
  /^(footway|pedestrian|residential|living_street|tertiary|secondary|primary|service|path)$/;

const dLat = RAD / 111_320;
const dLng = RAD / Math.max(1, 111_320 * Math.cos((LAT * Math.PI) / 180));
const minLat = LAT - dLat, maxLat = LAT + dLat;
const minLng = LNG - dLng, maxLng = LNG + dLng;

const nodes = new Map(); // id -> {type,id,lat,lon}
const ways = [];

osmread.parse({
  filePath: "C:/Temp/opencode/vietnam-latest.osm.pbf",
  node(n) {
    if (n.lat >= minLat && n.lat <= maxLat && n.lon >= minLng && n.lon <= maxLng) {
      nodes.set(n.id, { type: "node", id: n.id, lat: n.lat, lon: n.lon });
    }
  },
  way(w) {
    const hw = w.tags && w.tags.highway;
    if (!hw || !HIGHWAY_RE.test(hw)) return;
    if (!w.nodeRefs || w.nodeRefs.length < 2) return;
    // drop border-crossing ways (all refs must be in bbox)
    if (!w.nodeRefs.every((id) => nodes.has(id))) return;
    ways.push({ type: "way", id: w.id, nodes: w.nodeRefs });
  },
  endDocument() {
    const data = { version: 0.6, elements: [...nodes.values(), ...ways] };
    fs.writeFileSync(out, JSON.stringify(data));
    console.log(`nodes=${nodes.size} ways=${ways.length} -> ${out}`);
  },
  error(e) {
    console.error("pbf error", e);
    process.exit(1);
  },
});
