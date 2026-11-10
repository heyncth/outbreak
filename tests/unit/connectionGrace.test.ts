import { describe, expect, it } from "vitest";
import {
  DISCONNECT_MS,
  GRACE_MS,
  HOST_MIGRATE_MS,
  derivePlayerState,
  nextHostId,
  shouldMigrateHost,
  shouldRestore,
} from "@/engine/connectionGrace";

const T0 = 1_000_000;

describe("derivePlayerState", () => {
  it("live within 10s", () => {
    const r = derivePlayerState(
      { player_id: "a", last_seen_ms: T0, prior_state: "ALIVE", joined_at_ms: T0 },
      T0 + DISCONNECT_MS
    );
    expect(r).toEqual({ kind: "LIVE", state: "ALIVE" });
  });

  it("disconnected after 10s with grace remaining", () => {
    const r = derivePlayerState(
      { player_id: "a", last_seen_ms: T0, prior_state: "KNOCKED", joined_at_ms: T0 },
      T0 + DISCONNECT_MS + 1000
    );
    expect(r.kind).toBe("DISCONNECTED");
    if (r.kind === "DISCONNECTED") {
      expect(r.grace_remaining_ms).toBe(GRACE_MS - 1000);
    }
  });

  it("expired after 10s + 90s", () => {
    const r = derivePlayerState(
      { player_id: "a", last_seen_ms: T0, prior_state: "ALIVE", joined_at_ms: T0 },
      T0 + DISCONNECT_MS + GRACE_MS
    );
    expect(r).toEqual({ kind: "EXPIRED" });
  });
});

describe("shouldRestore", () => {
  it("restores within grace", () => {
    expect(shouldRestore("KNOCKED", T0 + 5_000, T0)).toBe("KNOCKED");
  });
  it("null past grace", () => {
    expect(shouldRestore("ALIVE", T0 + GRACE_MS, T0)).toBeNull();
  });
});

describe("shouldMigrateHost", () => {
  it("false at 15s boundary inclusive", () => {
    expect(shouldMigrateHost(T0, T0 + HOST_MIGRATE_MS)).toBe(false);
  });
  it("true past 15s", () => {
    expect(shouldMigrateHost(T0, T0 + HOST_MIGRATE_MS + 1)).toBe(true);
  });
});

describe("nextHostId", () => {
  it("picks earliest joined ALIVE excluding current host", () => {
    const id = nextHostId(
      [
        { player_id: "host", joined_at_ms: T0, state: "ALIVE" },
        { player_id: "b", joined_at_ms: T0 + 100, state: "ALIVE" },
        { player_id: "a", joined_at_ms: T0 + 50, state: "ALIVE" },
        { player_id: "k", joined_at_ms: T0 + 10, state: "KNOCKED" },
      ],
      "host",
      T0
    );
    expect(id).toBe("a");
  });

  it("null when no eligible", () => {
    expect(
      nextHostId([{ player_id: "only", joined_at_ms: T0, state: "ALIVE" }], "only", T0)
    ).toBeNull();
  });
});
