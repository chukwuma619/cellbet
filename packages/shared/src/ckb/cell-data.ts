import { sha256 } from "js-sha256";

/** Raw 32-byte SHA-256 of UTF-8 string (same preimage as lowercase hex from `sha256HexUtf8`). */
export function sha256BytesUtf8(utf8String: string): Uint8Array {
  const hex = sha256(utf8String);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** `crash-round-anchor`: 8-byte LE round id + 32-byte commitment. */
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

/** `crash-settlement-split` v1: flags must be 0. */
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

/** Witness for spending `crash-round-anchor`: LE round id + UTF-8 server seed bytes. */
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

/** Witness for spending `crash-settlement-split` v1 (18 bytes). */
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
