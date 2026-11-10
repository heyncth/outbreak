# 04 · UI/UX SPECIFICATION (v2.0)

## 1. Design Principles

1. **High-Contrast Tactical Dark UI:** Dark base `#090D16`, white text, neon alerts — readable in direct sunlight while running.
2. **One-Handed Thumb Zone:** All critical controls in the bottom 1/3 of the screen.
3. **Shape + Color + Haptics:** Never distinguish Zombie types by color alone (sun glare / colorblind).
4. **Glanceable HUD:** Player must read HP/noise/threat in < 1 s while moving.

---

## 2. Design Tokens

### 2.1 Color

| Token | Value | Usage |
| --- | --- | --- |
| `--color-bg` | `#090D16` | App background |
| `--color-surface` | `#111827` | Cards, panels |
| `--color-border` | `#1F2937` | Dividers |
| `--color-text` | `#F9FAFB` | Primary text (≥ 7:1 on bg for critical numerics) |
| `--color-text-muted` | `#9CA3AF` | Secondary labels |
| `--color-danger` | `#EF4444` | Zombies, damage, end |
| `--color-danger-soft` | `#F87171` | Walker marker |
| `--color-danger-deep` | `#991B1B` | Brute marker |
| `--color-safe` | `#10B981` | Safe Zone, primary CTA |
| `--color-player` | `#3B82F6` | Local player |
| `--color-teammate` | `#06B6D4` | Teammates |
| `--color-stalker` | `#A855F7` | Stalker marker |
| `--color-screamer` | `#F59E0B` | Screamer marker |
| `--color-warning` | `#FBBF24` | GPS weak, wake lock off |
| `--color-knock` | `#F97316` | KNOCKED teammate flash |

### 2.2 Spacing & radius

| Token | Value |
| --- | --- |
| `--space-1` … `--space-8` | `4, 8, 12, 16, 24, 32, 40, 48` px |
| `--radius-sm/md/lg/full` | `6 / 10 / 16 / 9999` px |
| `--tap-min` | `48 × 48` px |
| `--tap-rescue` | height `64` px |

### 2.3 Type scale

| Token | Size / weight | Use |
| --- | --- | --- |
| `--text-display` | `28px / 700` | Summary titles |
| `--text-h1` | `22px / 700` | Screen titles |
| `--text-h2` | `18px / 600` | Section headers |
| `--text-body` | `15px / 400` | Body |
| `--text-mono-stat` | `20px / 700` tabular-nums | HP, timer, distance |
| `--text-caption` | `12px / 500` | Marker labels, badges |

### 2.4 Layers

| Token | z-index |
| --- | --- |
| `--z-map` | 0 |
| `--z-markers` | 10 |
| `--z-hud` | 100 |
| `--z-banner` | 200 |
| `--z-modal` | 300 |
| `--z-dev` | 400 |

### 2.5 Motion

| Motion | Spec |
| --- | --- |
| Marker interpolation | Linear LERP **950 ms** between 1 Hz ticks (no 1 Hz teleport) |
| Danger vignette pulse | Opacity 0 → 0.35 → 0, **1200 ms** loop while `CHASE` dist ≤ 15 m |
| Knockdown overlay | Fade in **300 ms**; countdown digits update 1 Hz |
| Rescue hold progress | Fill width 0→100% over **3000 ms** linear; cancel on release or range break |
| Safe Zone ring | Static fill `rgba(16,185,129,0.2)`; dashed border `8 4` |
| Screamer alert ring | Radius pulse **800 ms** ease-out once per alert |
| Button press | Scale 0.97, **100 ms** |

---

## 3. Screens

### 3.1 Home / Quick Entry

**Components**
- Logo `OUTBREAK` (radar motif).
- Nickname input (dark fill, light border): 2–20 chars, live validation.
- Primary **[CREATE NEW ROOM]** — `#10B981`, height **56 px**, full width in thumb zone.
- Room code input (6 chars, uppercase) + **[JOIN]**.
- GPS status chip top-right:  
  `🟢 GPS ready (±4m)` | `🔴 Searching for GPS…` | `🟡 Weak GPS (±Xm)`

**States**
- GPS denied → blocking modal (Flow 1).
- Nickname invalid → inline error under field.

### 3.2 Lobby

**Components**
- Header: large room code (`OB-4829`) + **[Copy invite link]**.
- Mini-map preview: cyan dots for members.
- Roster `n/10`: name + distance to Host (`12 m away`).
- Host footer: **[START SURVIVAL]** + quick zombie-density select (Low/Med/High).

**States**
- Room full on late joiner: error toast `ROOM_FULL`.
- Waiting for GPS on member: row badge `GPS…`.

### 3.3 In-Game HUD

```
┌────────────────────────────────────────────────────────┐
│ ❤️ HP: [████████░░] 80/100      🟢 GPS: ±5m | 👥 4/4   │
│ 🔊 Noise: [███░░░░░░░] Walk     ⏱️ 12:45               │
├────────────────────────────────────────────────────────┤
│                 [ MAPLIBRE FULL MAP ]                  │
│            🔴 (Runner - 35m)  ▸                         │
│                     🔵 (You)                           │
│                                   🛡️ [Safe Zone - 80m] │
│                                                   [🎯] │
├────────────────────────────────────────────────────────┤
│ [ 🆘 RESCUE TEAMMATE (6m) ]     (conditional)          │
│ [ 🛡️ CREATE SAFE ZONE ] (Host)  [ 🛑 END ] (Host)     │
└────────────────────────────────────────────────────────┘
```

**Markers**

| Entity | Visual | Notes |
| --- | --- | --- |
| You | Circle `#3B82F6` + noise radius ring | Ring scales with current noise |
| Teammate | Circle `#06B6D4` + name label | KNOCKED: `#F97316` blink + `🆘` + `59s` |
| Walker | Small circle `#F87171` | |
| Runner | Triangle `#EF4444` + heading notch | |
| Stalker | Diamond `#A855F7` opacity 0.45 | Full opacity when dist < 25 m |
| Screamer | Star/pentagon `#F59E0B` + alert ring | |
| Brute | Hexagon `#991B1B` larger radius | |
| Safe Zone | Fill `rgba(16,185,129,0.2)`, dashed `#10B981` | |

**HUD rules**
- Rescue button visible only when: local `ALIVE`, target `KNOCKED`, dist ≤ 10.0 m, countdown remaining > 0.
- End / Create Safe Zone visible only for current Host.
- Cooldown badge on Create Safe Zone: `10:00` remaining.

### 3.4 Summary Screen

- Title: **SURVIVAL SESSION ENDED** or **FULL TEAM DOWN**.
- Stat cards (personal + team): survival `MM:SS`, distance (`m`/`km`), max speed (`km/h`), rescues.
- Tech strip (collapsible): GPS accuracy avg, ping, wake-lock drops.
- **[REMATCH ROOM]** (Host) · **[BACK TO HOME]**.

---

## 4. Component Contracts

### 4.1 `HPBar`
- Props: `hp: number`, `maxHp: number`, `penalizedMax?: number`.
- Segments: current HP fill `#10B981` (or `#EF4444` when ≤ 30%); permanent lost max as dark red track segment.
- A11y: `role="progressbar"`, `aria-valuenow={hp}`, `aria-valuemax={maxHp}`, label `Health X of Y`.
- States: default | low (≤30 pulse) | knocked (hidden behind overlay).

### 4.2 `HoldToRescueButton`
- Props: `distM: number`, `disabled: boolean`, `onComplete()`.
- Height **64 px**, min width full content, progress fill 3000 ms.
- Disabled: opacity 0.4, no pointer events.
- Break range > 10.0 m or release → cancel, progress 0.
- Haptic: single tick at 1000/2000/3000 ms; success pattern `[50, 50, 50]`.
- A11y name: `Rescue teammate, hold 3 seconds`.

### 4.3 `NoiseMeter`
- Discrete labels: Still / Walk / Run / Sprint with bar 0–100% from noise `0.05–1.0`.
- Color: `#10B981` / `#3B82F6` / `#F59E0B` / `#EF4444`.

### 4.4 `ZombieMarker` (MapLibre)
- Shape by type (see §3.3), size scale: walker 10, runner 12, stalker 11, screamer 13, brute 18 (px at zoom ref).
- Position updated via source `setData` or DOM marker `setLngLat` — **never** React remount per tick.
- Interpolation: LERP 950 ms.

### 4.5 `BlockingModal`
- Focus trap, dismiss only via primary action when `blocking`.
- Backdrop `rgba(0,0,0,0.72)`, surface `#111827`, border `#1F2937`.

### 4.6 `DevSimulatorPanel`
- Visible only if runtime devsim flag is on (`?devsim=1` → `localStorage.outbreak_devsim`).
- z-index `--z-dev`; does not cover bottom thumb zone on portrait.

---

## 5. UI States (special)

| State | Presentation |
| --- | --- |
| Chased (`CHASE` ≤ 15 m) | Vignette pulse + `navigator.vibrate([200, 100, 200])` (Android) |
| KNOCKED | Gray-red scrim, centered countdown: *"Waiting for rescue… 45s (or auto Safe Zone)"* |
| GPS weak | Top banner yellow: *"⚠️ Weak GPS. Move to open area."* |
| SPEED_ANOMALY | Top banner: *"Speed too high — distance not counted"* |
| DISCONNECTED | Banner: *"Reconnecting… (90s grace)"* + ghost avatar style |
| WakeLock unsupported | Subtle chip `WakeLock: Off` + hint to tap screen |
| DIRECT_VECTOR_FALLBACK | Chip `⚠️ Road fallback` (dev/ops visibility) |

---

## 6. Accessibility & Outdoor Use

1. **Contrast:** Critical numerics (HP, countdown, room code) ≥ **7:1** (WCAG AAA). Body ≥ 4.5:1.
2. **Touch targets:** ≥ **48×48 px**; rescue control height **64 px**.
3. **Not color-only:** Each Zombie type has unique geometry (circle / triangle / diamond / star / hexagon) + optional vibration pattern on first local detection:
   - Runner: `[30]`
   - Brute: `[100, 40, 100]`
   - Screamer: `[20, 40, 20, 40, 20]`
4. **Live regions:** HP and knockdown countdown in `aria-live="polite"` (not every tick — throttle to 1 s or state change).
5. **Reduced motion:** Honor `prefers-reduced-motion: reduce` → disable vignette pulse; keep essential state changes.

---

## 7. Breakpoints

| Name | Width | Layout notes |
| --- | --- | --- |
| Mobile portrait (primary) | 360–430 px | Full-bleed map; HUD top 88 px; actions bottom thumb zone |
| Mobile landscape / phablet | 640–768 px | HUD splits left/right rails; map fills center |
| Desktop dev/spectator | ≥ 1024 px | Dev panel beside map; max content width 1200 px centered |

Map height: `calc(100dvh - hudTop - hudBottom)` on mobile; never re-create `maplibregl.Map` on resize — `map.resize()` only.

---

## 8. Iconography & Copy tone

- Buttons: imperative, uppercase for primary (`START SURVIVAL`, `END MATCH`).
- Errors: actionable second sentence (what to do next).
- No emoji required for function; emoji used only as secondary marker cues already specified.
