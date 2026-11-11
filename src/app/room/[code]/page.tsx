"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LobbyView } from "@/components/lobby/LobbyView";
import { useGPS } from "@/hooks/useGPS";
import { useGameStore } from "@/store/useGameStore";
import { readSession } from "@/lib/session";
import { dbg } from "@/lib/debug";

type Step = "checking" | "need_name" | "joining" | "ready" | "error";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const roomCode = (params.code ?? "").toUpperCase();
  const router = useRouter();
  const { status: gpsStatus, reading, start } = useGPS();
  const playerId = useGameStore((s) => s.playerId);
  const nickname = useGameStore((s) => s.nickname);
  const setSession = useGameStore((s) => s.setSession);
  const setSelfPos = useGameStore((s) => s.setSelfPos);
  const [step, setStep] = useState<Step>("checking");
  const [nameInput, setNameInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    setSession(readSession());
    void start();
  }, [setSession, start]);

  useEffect(() => {
    if (reading) setSelfPos({ lat: reading.lat, lng: reading.lng });
  }, [reading, setSelfPos]);

  useEffect(() => {
    if (!playerId) return;
    if (!nickname || nickname.trim().length < 2) {
      setStep("need_name");
      return;
    }
    if (gpsStatus !== "granted") {
      setStep("checking");
      return;
    }
    if (step === "ready" || step === "joining" || step === "error" || joining) return;

    const lat = reading?.lat ?? 16.054407;
    const lng = reading?.lng ?? 108.202167;
    const flags = reading?.flags ?? [];

    setStep("joining");
    setJoining(true);
    (async () => {
      try {
        const res = await fetch("/api/rooms/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_code: roomCode,
            nickname: nickname.trim(),
            player_id: playerId,
            lat,
            lng,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setJoinError(data?.error?.message ?? "Join failed");
          setStep("error");
          return;
        }
        useGameStore.getState().resetRoom();
        useGameStore.getState().setSession({
          playerId,
          nickname: nickname.trim(),
          joinToken: data.join_token ?? null,
        });
        useGameStore.getState().setRoom({
          roomCode,
          isHost: Boolean(data.is_host),
          roomId: data.room_id ?? null,
        });
        setJoinError(null);
        setStep("ready");
      } catch {
        setJoinError("Network error");
        setStep("error");
      } finally {
        setJoining(false);
      }
    })();
  }, [playerId, nickname, gpsStatus, reading, roomCode, step, joining]);

  useEffect(() => {
    dbg("room step", step, joinError ?? undefined);
  }, [step, joinError]);

  if (step === "checking" || step === "joining") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6">
        <h1 className="text-xl font-bold tracking-widest text-safe">ROOM {roomCode}</h1>
        <p className="text-sm text-muted">
          {step === "joining"
            ? "Joining…"
            : gpsStatus === "requesting" || gpsStatus === "idle"
              ? "Waiting for GPS permission…"
              : gpsStatus === "denied"
                ? "Location denied. Enable GPS in browser settings, then reload."
                : gpsStatus === "unavailable"
                  ? "GPS unavailable on this device."
                  : "Connecting…"}
        </p>
        {(gpsStatus === "denied" || gpsStatus === "unavailable") && (
          <button
            onClick={() => router.push("/")}
            className="rounded border border-line px-4 py-2 text-sm"
          >
            Home
          </button>
        )}
      </main>
    );
  }

  if (step === "need_name") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
        <h1 className="text-xl font-bold tracking-widest text-safe">ROOM {roomCode}</h1>
        <p className="text-sm text-muted">Enter nickname to join.</p>
        <input
          data-testid="join-nickname"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          maxLength={30}
          placeholder="Nickname"
          className="rounded border border-line bg-panel px-3 py-3 text-base outline-none focus:border-safe"
        />
        <button
          data-testid="confirm-join"
          disabled={nameInput.trim().length < 2 || nameInput.trim().length > 30}
          onClick={() => {
            setSession({ ...readSession(), nickname: nameInput.trim() });
          }}
          className="rounded bg-safe px-4 py-3 font-bold text-bg disabled:opacity-40"
        >
          Join
        </button>
      </main>
    );
  }

  if (step === "error") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
        <h1 className="text-xl font-bold text-danger">Join failed</h1>
        <p className="text-sm text-muted">{joinError}</p>
        <button
          onClick={() => {
            setJoinError(null);
            setStep("checking");
          }}
          className="rounded border border-line px-4 py-3"
        >
          Retry
        </button>
        <button onClick={() => router.push("/")} className="rounded border border-line px-4 py-3">
          Home
        </button>
      </main>
    );
  }

  return <LobbyView roomCode={roomCode} />;
}
