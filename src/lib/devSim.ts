const KEY = "outbreak_devsim";

export function isDevSim(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Parse ?devsim=0|1 once on client entry; persists choice. */
export function applyDevSimFromSearch(): void {
  if (typeof window === "undefined") return;
  try {
    const v = new URLSearchParams(window.location.search).get("devsim");
    if (v === "1") window.localStorage.setItem(KEY, "1");
    else if (v === "0") window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
