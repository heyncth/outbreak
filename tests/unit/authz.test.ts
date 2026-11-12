import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp, rateLimit, requireJoinToken } from "@/lib/api";

type Row = { data?: unknown; error?: unknown } | null | undefined;

function fakeSb(queue: Record<string, Row[]>, rpcResult: { data: unknown; error: unknown } = { data: null, error: null }) {
  return {
    from(table: string) {
      const result = queue[table]?.shift();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: () => b,
        insert: () => b,
        delete: () => b,
        eq: () => b,
        neq: () => b,
        lt: () => b,
        lte: () => b,
        order: () => b,
        maybeSingle: async () => result ?? { data: null, error: null },
        single: async () => result ?? { data: null, error: null },
        then: (onF?: ((v: Row) => unknown) | null, onR?: ((v: unknown) => unknown) | null) =>
          Promise.resolve(result ?? { data: null, error: null }).then(onF, onR),
      };
      return b;
    },
    rpc: vi.fn(async () => rpcResult),
  };
}

const asClient = (c: unknown): SupabaseClient => c as SupabaseClient;

const joinMock = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  serverClient: () => joinMock.client,
  browserClient: () => joinMock.client,
}));
vi.mock("@/lib/broadcast", () => ({
  broadcastLobby: async () => {},
  broadcastAction: async () => {},
}));

const ROOM_ID = "c81d4e2e-bcf2-11e6-869b-7df92533d2db";
const PLAYER_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TOKEN = "3a5f8c2e-1d4b-4a6f-9c8e-7b2a1d3f5e6a";

describe("rateLimit", () => {
  it("allows up to the limit then rejects within the window", () => {
    const key = `t-${Date.now()}-a`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3)).toBe(true);
    expect(rateLimit(key, 3)).toBe(false);
  });

  it("keys are independent", () => {
    const base = `t-${Date.now()}-b`;
    expect(rateLimit(`${base}:x`, 1)).toBe(true);
    expect(rateLimit(`${base}:x`, 1)).toBe(false);
    expect(rateLimit(`${base}:y`, 1)).toBe(true);
  });

  it("resets after the window", () => {
    vi.useFakeTimers();
    const key = `t-${Date.now()}-c`;
    expect(rateLimit(key, 1)).toBe(true);
    expect(rateLimit(key, 1)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rateLimit(key, 1)).toBe(true);
    vi.useRealTimers();
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    const req = new NextRequest("http://t/", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back when the header is absent", () => {
    expect(clientIp(new NextRequest("http://t/"))).toBe("na");
  });
});

describe("requireJoinToken — fail closed", () => {
  const sb = () => fakeSb({ room_players: [{ data: { join_token: TOKEN }, error: null }] });

  it("accepts the matching stored token", async () => {
    await expect(requireJoinToken(asClient(sb()), ROOM_ID, PLAYER_ID, TOKEN)).resolves.toBe(true);
  });

  it("rejects a wrong token", async () => {
    await expect(
      requireJoinToken(asClient(sb()), ROOM_ID, PLAYER_ID, "00000000-0000-4000-8000-000000000000")
    ).resolves.toBe(false);
  });

  it("rejects non-string / non-uuid tokens without touching the db", async () => {
    const client = fakeSb({});
    await expect(requireJoinToken(asClient(client), ROOM_ID, PLAYER_ID, null)).resolves.toBe(false);
    await expect(requireJoinToken(asClient(client), ROOM_ID, PLAYER_ID, "nope")).resolves.toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects when the row is missing", async () => {
    const client = fakeSb({ room_players: [{ data: null, error: null }] });
    await expect(requireJoinToken(asClient(client), ROOM_ID, PLAYER_ID, TOKEN)).resolves.toBe(false);
  });

  it("rejects on db error", async () => {
    const client = fakeSb({ room_players: [{ data: null, error: { message: "boom" } }] });
    await expect(requireJoinToken(asClient(client), ROOM_ID, PLAYER_ID, TOKEN)).resolves.toBe(false);
  });
});

describe("join route — rejoin token oracle", () => {
  const setClient = (c: ReturnType<typeof fakeSb>) => {
    joinMock.client = c;
    return c;
  };

  function makeRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest("http://t/api/rooms/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const baseBody = {
    room_code: "OB8423",
    nickname: "Tester",
    player_id: PLAYER_ID,
    lat: 16.05,
    lng: 108.2,
  };

  it("403s a rejoin without the stored token — no rpc, no writes", async () => {
    const client = setClient(fakeSb({
      game_rooms: [{ data: { id: ROOM_ID, host_player_id: "h", status: "ACTIVE" }, error: null }],
      room_players: [{ data: { id: "p-row", join_token: TOKEN }, error: null }],
    }));
    const { POST } = await import("@/app/api/rooms/join/route");
    const res = await POST(makeRequest({ ...baseBody }));
    expect(res.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("returns the token for a verified rejoin", async () => {
    setClient(fakeSb({
      game_rooms: [{ data: { id: ROOM_ID, host_player_id: PLAYER_ID, status: "ACTIVE" }, error: null }],
      room_players: [
        { data: { id: "p-row", join_token: TOKEN }, error: null }, // existing lookup
        { data: null, error: null }, // last_seen update
        { data: { join_token: TOKEN }, error: null }, // token readback
      ],
    }));
    const { POST } = await import("@/app/api/rooms/join/route");
    const res = await POST(makeRequest({ ...baseBody, join_token: TOKEN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rejoined?: boolean; join_token?: string };
    expect(body.rejoined).toBe(true);
    expect(body.join_token).toBe(TOKEN);
  });

  it("rejects a fresh player when the match already started", async () => {
    setClient(fakeSb({
      game_rooms: [{ data: { id: ROOM_ID, host_player_id: "h", status: "ACTIVE" }, error: null }],
      room_players: [{ data: null, error: null }],
    }));
    const { POST } = await import("@/app/api/rooms/join/route");
    const res = await POST(makeRequest({ ...baseBody }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("MATCH_ALREADY_STARTED");
  });
});
