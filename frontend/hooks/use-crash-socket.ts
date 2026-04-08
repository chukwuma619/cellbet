"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { fetchCrashState, getApiBaseUrl } from "@/lib/api";

export type CrashRoundPublic = {
  id: string;
  roundKey: string;
  chainRoundId?: string;
  phase: string;
  serverSeedHash: string;
  bettingEndsAt: number;
  currentMultiplier: number;
  commitAnchored?: boolean;
  crashMultiplier?: number;
  serverSeed?: string;
  combinedClientSeed?: string;
};

export type CrashParticipant = {
  betId: string;
  roundId: string;
  ckbAddress: string;
  amount: string;
  tokenSymbol: string;
  status: string;
  cashedOutAtMultiplier?: number;
  /** Net payout after platform fee */
  winAmount?: number;
  grossWinAmount?: number;
  platformFee?: number;
};

function normalizeParticipants(raw: unknown): CrashParticipant[] {
  if (!Array.isArray(raw)) return [];
  const out: CrashParticipant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const betId = o.betId != null ? String(o.betId) : "";
    const roundId = o.roundId != null ? String(o.roundId) : "";
    const ckbAddress = o.ckbAddress != null ? String(o.ckbAddress) : "";
    if (!betId || !ckbAddress) continue;
    const amount = o.amount != null ? String(o.amount) : "0";
    const tokenSymbol =
      o.tokenSymbol != null ? String(o.tokenSymbol) : "CKB";
    const status = o.status != null ? String(o.status) : "pending";
    const multRaw = o.cashedOutAtMultiplier;
    const cashedOutAtMultiplier =
      typeof multRaw === "number"
        ? multRaw
        : multRaw != null
          ? Number(multRaw)
          : undefined;
    const winRaw = o.winAmount;
    const winAmount =
      typeof winRaw === "number"
        ? winRaw
        : winRaw != null
          ? Number(winRaw)
          : undefined;
    const grossRaw = o.grossWinAmount;
    const grossWinAmount =
      typeof grossRaw === "number"
        ? grossRaw
        : grossRaw != null
          ? Number(grossRaw)
          : undefined;
    const feeRaw = o.platformFee;
    const platformFee =
      typeof feeRaw === "number"
        ? feeRaw
        : feeRaw != null
          ? Number(feeRaw)
          : undefined;
    out.push({
      betId,
      roundId,
      ckbAddress,
      amount,
      tokenSymbol,
      status,
      cashedOutAtMultiplier:
        cashedOutAtMultiplier !== undefined &&
        Number.isFinite(cashedOutAtMultiplier)
          ? cashedOutAtMultiplier
          : undefined,
      winAmount:
        winAmount !== undefined && Number.isFinite(winAmount)
          ? winAmount
          : undefined,
      grossWinAmount:
        grossWinAmount !== undefined && Number.isFinite(grossWinAmount)
          ? grossWinAmount
          : undefined,
      platformFee:
        platformFee !== undefined && Number.isFinite(platformFee)
          ? platformFee
          : undefined,
    });
  }
  return out;
}

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
  const chainRaw = raw.chainRoundId;
  const ca = raw.commitAnchored;
  return {
    id: String(raw.id),
    roundKey: String(raw.roundKey ?? ""),
    chainRoundId:
      chainRaw !== undefined && chainRaw !== null ? String(chainRaw) : undefined,
    phase: String(raw.phase ?? "betting"),
    serverSeedHash: String(raw.serverSeedHash ?? ""),
    bettingEndsAt,
    currentMultiplier: Number(raw.currentMultiplier ?? 1),
    commitAnchored:
      ca === true || ca === "true" || ca === 1,
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
  const [participants, setParticipants] = useState<CrashParticipant[]>([]);
  /** Kept after a new round starts so “Verify fairness” still has seed + keys. */
  const [lastSettledRound, setLastSettledRound] =
    useState<CrashRoundPublic | null>(null);

  useEffect(() => {
    void fetchCrashState()
      .then((data) => {
        const d = data as {
          round?: Record<string, unknown> | null;
          participants?: unknown;
        };
        setRound(normalizeRound(d.round ?? null));
        setParticipants(normalizeParticipants(d.participants));
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

    socket.on(
      "crash:state",
      (payload: {
        round?: Record<string, unknown>;
        participants?: unknown;
      }) => {
        setRound(normalizeRound(payload.round ?? null));
        setParticipants(normalizeParticipants(payload.participants));
      },
    );

    socket.on("crash:bet_placed", (payload: Record<string, unknown>) => {
      const betId = payload.betId != null ? String(payload.betId) : "";
      const roundId = payload.roundId != null ? String(payload.roundId) : "";
      const ckbAddress =
        payload.ckbAddress != null ? String(payload.ckbAddress) : "";
      const amount = payload.amount != null ? String(payload.amount) : "0";
      const tokenSymbol =
        payload.tokenSymbol != null ? String(payload.tokenSymbol) : "CKB";
      if (!betId || !ckbAddress) return;
      setParticipants((prev) => {
        if (prev.some((p) => p.betId === betId)) return prev;
        return [
          ...prev,
          {
            betId,
            roundId,
            ckbAddress,
            amount,
            tokenSymbol,
            status: "pending",
          },
        ];
      });
    });

    socket.on("crash:cash_out", (payload: Record<string, unknown>) => {
      const betId = payload.betId != null ? String(payload.betId) : "";
      const roundId = payload.roundId != null ? String(payload.roundId) : "";
      const mult = payload.cashedOutAtMultiplier;
      const cashedOutAtMultiplier =
        typeof mult === "number" ? mult : mult != null ? Number(mult) : NaN;
      const winRaw = payload.winAmount;
      const winAmount =
        typeof winRaw === "number"
          ? winRaw
          : winRaw != null
            ? Number(winRaw)
            : NaN;
      const grossRaw = payload.grossWinAmount;
      const grossWinAmount =
        typeof grossRaw === "number"
          ? grossRaw
          : grossRaw != null
            ? Number(grossRaw)
            : NaN;
      const feeRaw = payload.platformFee;
      const platformFee =
        typeof feeRaw === "number"
          ? feeRaw
          : feeRaw != null
            ? Number(feeRaw)
            : NaN;
      if (!betId || !Number.isFinite(cashedOutAtMultiplier)) return;
      setParticipants((prev) =>
        prev.map((p) => {
          if (p.betId !== betId) return p;
          if (roundId && p.roundId && p.roundId !== roundId) return p;
          return {
            ...p,
            status: "cashed_out",
            cashedOutAtMultiplier,
            winAmount: Number.isFinite(winAmount) ? winAmount : undefined,
            grossWinAmount: Number.isFinite(grossWinAmount)
              ? grossWinAmount
              : undefined,
            platformFee: Number.isFinite(platformFee) ? platformFee : undefined,
          };
        }),
      );
    });

    socket.on("crash:phase", (payload: Record<string, unknown>) => {
      setRound((prev) => {
        const newId =
          payload.roundId != null ? String(payload.roundId) : "";
        const idChanged =
          prev != null && newId !== "" && prev.id !== newId;
        const merged: Record<string, unknown> = {
          id: payload.roundId ?? prev?.id ?? "",
          roundKey: payload.roundKey ?? prev?.roundKey ?? "",
          chainRoundId:
            payload.chainRoundId ?? prev?.chainRoundId ?? "",
          phase: payload.phase ?? prev?.phase ?? "betting",
          serverSeedHash: payload.serverSeedHash ?? prev?.serverSeedHash ?? "",
          bettingEndsAt:
            payload.bettingEndsAt ?? prev?.bettingEndsAt ?? Date.now(),
          currentMultiplier: prev?.currentMultiplier ?? 1,
          commitAnchored: idChanged
            ? false
            : payload.commitAnchored ?? prev?.commitAnchored,
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

  return { connected, round, lastSettledRound, participants };
}
