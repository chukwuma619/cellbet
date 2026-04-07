"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { fetchCrashState, getApiBaseUrl } from "@/lib/api";

export type CrashRoundPublic = {
  id: string;
  roundKey: string;
  phase: string;
  serverSeedHash: string;
  bettingEndsAt: number;
  currentMultiplier: number;
  crashMultiplier?: number;
  serverSeed?: string;
  /** Combined bet client seeds (§4.9), revealed with server seed when settled. */
  combinedClientSeed?: string;
};

function normalizeRound(
  raw: Record<string, unknown> | null | undefined,
): CrashRoundPublic | null {
  if (!raw) return null;
  const be = raw.bettingEndsAt;
  const bettingEndsAt =
    typeof be === "number"
      ? be
      : typeof be === "string"
        ? new Date(be).getTime()
        : Date.now();
  return {
    id: String(raw.id),
    roundKey: String(raw.roundKey ?? ""),
    phase: String(raw.phase ?? "betting"),
    serverSeedHash: String(raw.serverSeedHash ?? ""),
    bettingEndsAt,
    currentMultiplier: Number(raw.currentMultiplier ?? 1),
    crashMultiplier:
      raw.crashMultiplier !== undefined && raw.crashMultiplier !== null
        ? Number(raw.crashMultiplier)
        : undefined,
    serverSeed:
      raw.serverSeed !== undefined && raw.serverSeed !== null
        ? String(raw.serverSeed)
        : undefined,
    combinedClientSeed:
      raw.combinedClientSeed !== undefined && raw.combinedClientSeed !== null
        ? String(raw.combinedClientSeed)
        : undefined,
  };
}

export function useCrashSocket() {
  const [connected, setConnected] = useState(false);
  const [round, setRound] = useState<CrashRoundPublic | null>(null);
  /** Kept after a new round starts so “Verify fairness” still has seed + keys. */
  const [lastSettledRound, setLastSettledRound] =
    useState<CrashRoundPublic | null>(null);

  useEffect(() => {
    void fetchCrashState()
      .then((data) => {
        const d = data as { round?: Record<string, unknown> | null };
        setRound(normalizeRound(d.round ?? null));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (
      round?.phase === "settled" &&
      round.serverSeed &&
      round.crashMultiplier !== undefined
    ) {
      const t = setTimeout(() => setLastSettledRound(round), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [round]);

  useEffect(() => {
    const base = getApiBaseUrl();
    const socket: Socket = io(`${base}/crash`, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("crash:state", (payload: { round?: Record<string, unknown> }) => {
      setRound(normalizeRound(payload.round ?? null));
    });

    socket.on("crash:phase", (payload: Record<string, unknown>) => {
      setRound((prev) => {
        const merged: Record<string, unknown> = {
          id: payload.roundId ?? prev?.id ?? "",
          roundKey: payload.roundKey ?? prev?.roundKey ?? "",
          phase: payload.phase ?? prev?.phase ?? "betting",
          serverSeedHash: payload.serverSeedHash ?? prev?.serverSeedHash ?? "",
          bettingEndsAt:
            payload.bettingEndsAt ?? prev?.bettingEndsAt ?? Date.now(),
          currentMultiplier: prev?.currentMultiplier ?? 1,
          crashMultiplier: prev?.crashMultiplier,
          serverSeed: prev?.serverSeed,
          combinedClientSeed: prev?.combinedClientSeed,
        };
        return normalizeRound(merged);
      });
    });

    socket.on("crash:tick", (payload: { multiplier?: number }) => {
      if (typeof payload.multiplier !== "number") return;
      setRound((prev) =>
        prev ? { ...prev, currentMultiplier: payload.multiplier! } : prev,
      );
    });

    socket.on(
      "crash:crashed",
      (payload: { crashMultiplier?: number; roundId?: string }) => {
        setRound((prev) => {
          if (!prev) return prev;
          if (payload.roundId && prev.id !== String(payload.roundId)) return prev;
          return {
            ...prev,
            phase: "crashed",
            crashMultiplier: payload.crashMultiplier ?? prev.crashMultiplier,
            currentMultiplier:
              payload.crashMultiplier ?? prev.currentMultiplier,
          };
        });
      },
    );

    socket.on(
      "crash:settled",
      (payload: {
        serverSeed?: string;
        crashMultiplier?: number;
        combinedClientSeed?: string;
      }) => {
        setRound((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            phase: "settled",
            serverSeed: payload.serverSeed ?? prev.serverSeed,
            crashMultiplier: payload.crashMultiplier ?? prev.crashMultiplier,
            combinedClientSeed:
              payload.combinedClientSeed ?? prev.combinedClientSeed,
          };
        });
      },
    );

    return () => {
      socket.disconnect();
    };
  }, []);

  return { connected, round, lastSettledRound };
}
