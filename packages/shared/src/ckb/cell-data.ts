import { sha256 } from "js-sha256";

import { DEFAULT_CRASH_CASHOUT_FEE_BPS } from "../crash/cashout-fee";

export function sha256BytesUtf8(utf8String: string): Uint8Array {
  const hex = sha256(utf8String);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function encodeRoundAnchorCellData(
  roundId: bigint,
  commitmentSha256Raw: Uint8Array,
): Uint8Array {
  if (commitmentSha256Raw.length !== 32) {
    throw new Error("commitmentSha256Raw must be 32 bytes");
  }
  const out = new Uint8Array(40);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, roundId, true);
  out.set(commitmentSha256Raw, 8);
  return out;
}

export function encodeSettlementCellDataV1(
  roundId: bigint,
  userLockHash: Uint8Array,
  houseLockHash: Uint8Array,
): Uint8Array {
  if (userLockHash.length !== 32 || houseLockHash.length !== 32) {
    throw new Error("lock hashes must be 32 bytes (script hash)");
  }
  const out = new Uint8Array(80);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, roundId, true);
  out.set(userLockHash, 8);
  out.set(houseLockHash, 40);
  view.setBigUint64(72, 0n, true);
  return out;
}

export function encodeRoundAnchorRevealWitness(
  roundId: bigint,
  serverSeedUtf8: string,
): Uint8Array {
  const seedBytes = new TextEncoder().encode(serverSeedUtf8);
  const out = new Uint8Array(8 + seedBytes.length);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, roundId, true);
  out.set(seedBytes, 8);
  return out;
}

export function encodeSettlementWitnessV1(params: {
  userPayoutShannons: bigint;
  housePayoutShannons: bigint;
  userOutputIndex: number;
  houseOutputIndex: number;
}): Uint8Array {
  const { userPayoutShannons, housePayoutShannons, userOutputIndex, houseOutputIndex } =
    params;
  if (userOutputIndex < 0 || userOutputIndex > 255 || houseOutputIndex < 0 || houseOutputIndex > 255) {
    throw new Error("output indices must be u8");
  }
  const out = new Uint8Array(18);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, userPayoutShannons, true);
  view.setBigUint64(8, housePayoutShannons, true);
  out[16] = userOutputIndex & 0xff;
  out[17] = houseOutputIndex & 0xff;
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
 * Default `feeBps` should match {@link DEFAULT_CRASH_CASHOUT_FEE_BPS} (300 = 3%).
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
    feeBps = DEFAULT_CRASH_CASHOUT_FEE_BPS,
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

/** Loss / forfeit: full stake to house, no platform fee (2-byte witness). */
export function encodeCrashForfeitWitnessV1(houseOutputIndex: number): Uint8Array {
  if (houseOutputIndex < 0 || houseOutputIndex > 255) {
    throw new Error("houseOutputIndex must be u8");
  }
  return new Uint8Array([0, houseOutputIndex & 0xff]);
}

export function decodeCrashEscrowCellDataV2(data: Uint8Array): {
  version: number;
  state: number;
  roundId: bigint;
  serverSeedHashSha256: Uint8Array;
  userLockHash: Uint8Array;
  houseLockHash: Uint8Array;
  platformLockHash: Uint8Array;
  stakeShannons: bigint;
  feeBps: number;
} {
  if (data.length !== 148) {
    throw new Error("escrow v2 cell data must be 148 bytes");
  }
  if (data[0] !== 1 || data[1] !== 1) {
    throw new Error("unexpected escrow version/state");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const roundId = view.getBigUint64(2, true);
  const serverSeedHashSha256 = data.slice(10, 42);
  const userLockHash = data.slice(42, 74);
  const houseLockHash = data.slice(74, 106);
  const stakeShannons = view.getBigUint64(106, true);
  const platformLockHash = data.slice(114, 146);
  const feeBps = view.getUint16(146, true);
  return {
    version: 1,
    state: 1,
    roundId,
    serverSeedHashSha256,
    userLockHash,
    houseLockHash,
    platformLockHash,
    stakeShannons,
    feeBps,
  };
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

export function encodeCrashWinWitnessV2(params: {
  userPayoutShannons: bigint;
  platformPayoutShannons: bigint;
  housePayoutShannons: bigint;
  userOutputIndex: number;
  platformOutputIndex: number;
  houseOutputIndex: number;
}): Uint8Array {
  const {
    userPayoutShannons,
    platformPayoutShannons,
    housePayoutShannons,
    userOutputIndex,
    platformOutputIndex,
    houseOutputIndex,
  } = params;
  for (const idx of [userOutputIndex, platformOutputIndex, houseOutputIndex]) {
    if (idx < 0 || idx > 255) throw new Error("output indices must be u8");
  }
  const out = new Uint8Array(28);
  const view = new DataView(out.buffer);
  out[0] = 1;
  view.setBigUint64(1, userPayoutShannons, true);
  view.setBigUint64(9, platformPayoutShannons, true);
  view.setBigUint64(17, housePayoutShannons, true);
  out[25] = userOutputIndex & 0xff;
  out[26] = platformOutputIndex & 0xff;
  out[27] = houseOutputIndex & 0xff;
  return out;
}
