import { createHash, randomBytes } from "crypto";

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function randomServerSeed(): string {
  return randomBytes(32).toString("hex");
}

/** Provably-fair style crash point from server seed + round key (uniform → multiplier). */
export function computeCrashMultiplier(serverSeed: string, roundKey: string): number {
  const h = createHash("sha256")
    .update(serverSeed)
    .update(roundKey)
    .digest();
  const u = h.readUInt32BE(0) / 2 ** 32;
  const safeU = Math.max(1e-9, Math.min(1 - 1e-9, u));
  const houseEdge = 0.01;
  const e = 1 - houseEdge;
  const raw = e / safeU;
  const m = Math.floor(raw * 100) / 100;
  return Math.min(1000, Math.max(1.01, m));
}

/** Deterministic running phase length (ms), 5s–20s. */
export function computeRunningDurationMs(serverSeed: string, roundKey: string): number {
  const h = createHash("sha256")
    .update(serverSeed)
    .update(roundKey)
    .update("duration")
    .digest();
  return 5000 + (h.readUInt32BE(0) % 15001);
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
