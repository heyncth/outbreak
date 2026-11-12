import type { LatLng } from "@/types/game";

export interface ShareCardInput {
  title: string;
  roomCode: string;
  nickname: string;
  durationSec: number;
  distanceM: number;
  maxSpeedMs: number;
  rescues: number;
  knockdowns: number;
  endReason: string;
  track: LatLng[];
  photo: HTMLImageElement | null;
  template?: "dark" | "light" | "minimal";
}

/** Project WGS84 track into canvas box (letterboxed). Pure — unit-testable. */
export function projectTrack(
  track: readonly LatLng[],
  width: number,
  height: number,
  padding = 80
): Array<{ x: number; y: number }> {
  if (track.length === 0) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of track) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const spanLat = Math.max(maxLat - minLat, 1e-7);
  const spanLng = Math.max(maxLng - minLng, 1e-7);
  const span = Math.max(spanLat, spanLng);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const box = Math.min(width - padding * 2, height - padding * 2);
  const scale = box / span;
  const cx = width / 2;
  const cy = height / 2;
  return track.map((p) => ({
    x: cx + (p.lng - midLng) * scale,
    y: cy - (p.lat - midLat) * scale,
  }));
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** Draw 1080×1080 share card. Photo bg if present, else dark + route. */
export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const w = 1080;
  const h = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");

  const template = input.template ?? "dark";
  const isLight = template === "light";
  const isMinimal = template === "minimal";
  const bg = isLight ? "#f4f7f4" : "#090D16";
  const fg = isLight ? "#0f1a0f" : "#F9FAFB";
  const muted = isLight ? "#5a6b5a" : "#9CA3AF";
  const accent = isLight ? "#16a34a" : "#10B981";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (!isMinimal && input.photo) {
    const img = input.photo;
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.fillStyle = isLight ? "rgba(244,247,244,0.55)" : "rgba(9,13,22,0.55)";
    ctx.fillRect(0, 0, w, h);
  } else if (!isMinimal && input.track.length >= 2) {
    const pts = projectTrack(input.track, w, h, 120);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first && last) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(first.x, first.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(last.x, last.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  }

  // bottom stats panel
  const grad = ctx.createLinearGradient(0, h * 0.45, 0, h);
  grad.addColorStop(0, "rgba(244,247,244,0)");
  grad.addColorStop(0.35, "rgba(244,247,244,0.85)");
  grad.addColorStop(1, "rgba(244,247,244,0.97)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h * 0.45, w, h * 0.55);

  ctx.fillStyle = fg;
  ctx.font = "700 52px system-ui, sans-serif";
  ctx.fillText(input.title, 64, h - 420);

  ctx.fillStyle = muted;
  ctx.font = "500 28px system-ui, sans-serif";
  ctx.fillText(`OUTBREAK · ${input.roomCode} · ${input.nickname}`, 64, h - 370);

  const stats: Array<[string, string]> = [
    ["TIME", fmtDuration(input.durationSec)],
    ["DIST", fmtDistance(input.distanceM)],
    ["MAX", `${(input.maxSpeedMs * 3.6).toFixed(1)} km/h`],
    ["RESCUE", String(input.rescues)],
    ["KNOCKS", String(input.knockdowns)],
  ];
  const colW = (w - 128) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = 64 + i * colW;
    ctx.fillStyle = muted;
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.fillText(label, x, h - 280);
    ctx.fillStyle = fg;
    ctx.font = "700 40px system-ui, sans-serif";
    ctx.fillText(value, x, h - 220);
  });

  ctx.fillStyle = accent;
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.fillText(input.endReason.replace(/_/g, " "), 64, h - 140);

  ctx.fillStyle = muted;
  ctx.font = "500 22px system-ui, sans-serif";
  ctx.fillText("I survived the outbreak.", 64, h - 80);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

export async function shareOrDownload(blob: Blob, filename: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (d: ShareData) => boolean;
    share?: (d: ShareData) => Promise<void>;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "OUTBREAK survival summary" });
      return "shared";
    } catch {
      /* fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
