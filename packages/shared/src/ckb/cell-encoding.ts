import { sha256 } from "js-sha256";

/**
 * Default fee encoded into escrow cell data when `feeBps` is omitted.
 * Must stay aligned with `DEFAULT_CRASH_CASHOUT_FEE_BPS` in the backend.
 */
const DEFAULT_CRASH_ESCROW_FEE_BPS = 300;

export function sha256BytesUtf8(utf8String: string): Uint8Array {
  const hex = sha256(utf8String);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Matches `crash-round` type script: version + state + round + hash (42 bytes). */
export function encodeCrashCommitCellDataV1(
  roundId: bigint,
  commitmentSha256Raw: Uint8Array,
): Uint8Array {
  if (commitmentSha256Raw.length !== 32) {
    throw new Error("commitmentSha256Raw must be 32 bytes");
  }
  const out = new Uint8Array(42);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = 0;
  view.setBigUint64(2, roundId, true);
  out.set(commitmentSha256Raw, 10);
  return out;
}

/**
 * Escrow cell for `crash-round` (148 bytes): platform lock + fee bps for on-chain win settlement.
 */
export function encodeCrashEscrowCellDataV2(params: {
  roundId: bigint;
  serverSeedHashSha256: Uint8Array;
  userLockHash: Uint8Array;
  houseLockHash: Uint8Array;
  platformLockHash: Uint8Array;
  stakeShannons: bigint;
  feeBps?: number;
}): Uint8Array {
  const {
    roundId,
    serverSeedHashSha256,
    userLockHash,
    houseLockHash,
    platformLockHash,
    stakeShannons,
    feeBps = DEFAULT_CRASH_ESCROW_FEE_BPS,
  } = params;
  if (
    serverSeedHashSha256.length !== 32 ||
    userLockHash.length !== 32 ||
    houseLockHash.length !== 32 ||
    platformLockHash.length !== 32
  ) {
    throw new Error("hashes must be 32 bytes");
  }
  if (feeBps < 0 || feeBps > 10_000) {
    throw new Error("feeBps must be 0..10000");
  }
  const out = new Uint8Array(148);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = 1;
  view.setBigUint64(2, roundId, true);
  out.set(serverSeedHashSha256, 10);
  out.set(userLockHash, 42);
  out.set(houseLockHash, 74);
  view.setBigUint64(106, stakeShannons, true);
  out.set(platformLockHash, 114);
  view.setUint16(146, feeBps, true);
  return out;
}

export function hex32ToBytes(hex: string): Uint8Array {
  const s = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(s)) {
    throw new Error("expected 64 hex chars (32 bytes)");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
