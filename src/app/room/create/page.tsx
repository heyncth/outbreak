"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";

const FALLBACK = { lat: 16.054407, lng: 108.202167 };

export default function CreateRoomPage() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const { playerId, nickname, selfPos } = useGameStore.getState();
      if (!playerId || !nickname || nickname.trim().length < 2) {
        router.replace("/");
        return;
      }
      const pos = selfPos ?? FALLBACK;
      try {
        const res = await fetch("/api/rooms/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nickname: nickname.trim(),
            player_id: playerId,
            lat: pos.lat,
            lng: pos.lng,
          }),
        });
        const data = (await res.json()) as {
          room_code?: string;
          room_id?: string;
          error?: { message: string };
        };
        if (!res.ok || !data.room_code) {
          router.replace("/");
          return;
        }
        useGameStore.getState().setRoom({
          roomCode: data.room_code,
          isHost: true,
          roomId: data.room_id ?? null,
        });
        router.replace(`/room/${data.room_code}`);
      } catch {
        router.replace("/");
      }
    })();
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6">
      <h1 className="text-xl font-bold tracking-widest text-safe">OUTBREAK</h1>
      <p className="text-sm text-muted">Creating room…</p>
    </main>
  );
}
