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
