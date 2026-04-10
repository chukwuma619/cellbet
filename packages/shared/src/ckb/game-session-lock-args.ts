/** Args layout for on-chain `game-session-lock` (v1), 106 bytes. Must match contract. */
export const GAME_SESSION_LOCK_ARGS_V1_LENGTH = 106;

export function scriptHashTypeToLockArgsByte(
  hashType: string,
): number {
  const t = hashType.trim().toLowerCase();
  if (t === "type") return 1;
  if (t === "data") return 0;
  if (t === "data1") return 2;
  if (t === "data2") return 4;
  throw new Error(`Unsupported CKB script hash type: ${hashType}`);
}

export function encodeGameSessionLockArgsV1(params: {
  userBlake160: Uint8Array;
  backendBlake160: Uint8Array;
  houseLockHash: Uint8Array;
  crashTypeCodeHash: Uint8Array;
  crashTypeHashTypeByte: number;
}): Uint8Array {
  const {
    userBlake160,
    backendBlake160,
    houseLockHash,
    crashTypeCodeHash,
    crashTypeHashTypeByte,
  } = params;
  if (userBlake160.length !== 20 || backendBlake160.length !== 20) {
    throw new Error("userBlake160 and backendBlake160 must be 20 bytes");
  }
  if (houseLockHash.length !== 32 || crashTypeCodeHash.length !== 32) {
    throw new Error("houseLockHash and crashTypeCodeHash must be 32 bytes");
  }
  const out = new Uint8Array(GAME_SESSION_LOCK_ARGS_V1_LENGTH);
  out[0] = 1;
  out.set(userBlake160, 1);
  out.set(backendBlake160, 21);
  out.set(houseLockHash, 41);
  out.set(crashTypeCodeHash, 73);
  out[105] = crashTypeHashTypeByte & 0xff;
  return out;
}
