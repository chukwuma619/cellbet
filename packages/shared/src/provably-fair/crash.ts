import { sha256 } from "js-sha256";

/** SHA-256 of UTF-8 string, lowercase hex (matches Node `createHash("sha256").update(s, "utf8")`). */
export function sha256HexUtf8(data: string): string {
  return sha256(data);
}

function sha256ConcatUtf8(parts: string[]): Uint8Array {
  const h = sha256.create();
  for (const p of parts) {
    h.update(p);
  }
  return new Uint8Array(h.array());
}

/**
 * Deterministic combination of per-bet client seeds (bet order = creation order).
 * Uses U+001E (record separator) between parts; each part is trimmed. Empty string if no parts.
 */
export function combineClientSeedsOrdered(parts: string[]): string {
  return parts.map((p) => p.trim()).join("\x1e");
}

/** Provably-fair crash point from server seed, round key, and optional client entropy (§4.3). */
export function computeCrashMultiplier(
  serverSeed: string,
  roundKey: string,
  clientSeed = "",
): number {
  const h = sha256ConcatUtf8([serverSeed, roundKey, clientSeed]);
  const u =
    ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) / 2 ** 32;
  const safeU = Math.max(1e-9, Math.min(1 - 1e-9, u));
  const houseEdge = 0.01;
  const e = 1 - houseEdge;
  const raw = e / safeU;
  const m = Math.floor(raw * 100) / 100;
  return Math.min(1000, Math.max(1.01, m));
}

/** Deterministic running phase length (ms), 5s–20s. */
export function computeRunningDurationMs(
  serverSeed: string,
  roundKey: string,
  clientSeed = "",
): number {
  const h = sha256ConcatUtf8([serverSeed, roundKey, clientSeed, "duration"]);
  const u32 =
    ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  return 5000 + (u32 % 15001);
}

export function multiplierAtElapsed(
  crashMultiplier: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (durationMs <= 0) return crashMultiplier;
  if (elapsedMs >= durationMs) return crashMultiplier;
  const p = elapsedMs / durationMs;
  return 1 + (crashMultiplier - 1) * p;
}

export type CrashVerifyResult = {
  commitmentValid: boolean;
  multiplierMatches: boolean;
  crashMultiplierComputed: number;
  runningDurationMsComputed: number;
};

/**
 * Verify commit-reveal for a Crash round: `server_seed_hash === sha256(server_seed)` and
 * `crash_multiplier === computeCrashMultiplier(server_seed, round_key, client_seed)`.
 */
export function verifyCrashRound(input: {
  serverSeed: string;
  roundKey: string;
  serverSeedHash: string;
  crashMultiplier: number;
  /** Combined client seeds for the round (§4.9); default `""` for legacy rounds. */
  clientSeed?: string;
}): CrashVerifyResult {
  const clientSeed = input.clientSeed ?? "";
  const expectedHash = sha256HexUtf8(input.serverSeed);
  const commitmentValid =
    expectedHash.toLowerCase() === input.serverSeedHash.trim().toLowerCase();
  const crashMultiplierComputed = computeCrashMultiplier(
    input.serverSeed,
    input.roundKey,
    clientSeed,
  );
  const runningDurationMsComputed = computeRunningDurationMs(
    input.serverSeed,
    input.roundKey,
    clientSeed,
  );
  const multiplierMatches =
    Math.abs(crashMultiplierComputed - input.crashMultiplier) < 1e-9;

  return {
    commitmentValid,
    multiplierMatches,
    crashMultiplierComputed,
    runningDurationMsComputed,
  };
}
