import {
  encodeGameSessionLockArgsV1,
  hex32ToBytes,
  scriptHashTypeToLockArgsByte,
} from "@cellbet/shared";
import {
  CellDep,
  CellInput,
  Script,
  Transaction,
  fixedPointFrom,
  hexFrom,
  type Hex,
  type Signer,
} from "@ckb-ccc/core";

import { clientMatchesExpectedNetwork } from "../config";
import {
  getCrashOnChainConfigFromEnv,
  type CrashOnChainConfig,
} from "../crash-config";
import { lockHashesForHouseAndPlatform } from "../crash-scripts";
import {
  getGameSessionLockConfigFromEnv,
  type GameSessionLockOnChainConfig,
} from "../game-session-config";
import { CellbetCkbError, mapCkbException } from "../errors";

function sessionCfgOrThrow(message: string): GameSessionLockOnChainConfig {
  try {
    return getGameSessionLockConfigFromEnv();
  } catch {
    throw new CellbetCkbError(message, "NOT_CONFIGURED");
  }
}

function crashCfgOrThrow(message: string): CrashOnChainConfig {
  try {
    return getCrashOnChainConfigFromEnv();
  } catch {
    throw new CellbetCkbError(message, "NOT_CONFIGURED");
  }
}

function gameSessionLockScript(
  sessionCfg: GameSessionLockOnChainConfig,
  lockArgsBytes: Uint8Array,
): Script {
  return Script.from({
    codeHash: sessionCfg.codeHash,
    hashType: sessionCfg.hashType,
    args: hexFrom(lockArgsBytes),
  });
}

function gameSessionCellDep(sessionCfg: GameSessionLockOnChainConfig): CellDep {
  return CellDep.from({
    outPoint: {
      txHash: sessionCfg.cellDep.outTxHash,
      index: sessionCfg.cellDep.outputIndex,
    },
    depType: sessionCfg.cellDep.depType,
  });
}

/**
 * One user signature: creates a live cell locked with `game-session-lock` (Pattern A wallet).
 * `backendLockArgsHex` must be the hex script args (20 bytes) for the server session key
 * from `GET /crash/session/config` (`backendLockArgsHex`).
 */
export async function buildFundGameSessionCellTx(params: {
  signer: Signer;
  capacityShannons: bigint;
  backendLockArgsHex: string;
}): Promise<Hex> {
  const { signer, capacityShannons, backendLockArgsHex } = params;
  const client = signer.client;
  if (!clientMatchesExpectedNetwork(client)) {
    throw new CellbetCkbError(
      "Wallet is not on the network this app expects.",
      "WRONG_NETWORK",
    );
  }
  if (capacityShannons <= BigInt(0)) {
    throw new CellbetCkbError("Capacity must be positive.", "UNKNOWN");
  }

  const sessionCfg = sessionCfgOrThrow(
    "Game session lock is not configured in env (NEXT_PUBLIC_GAME_SESSION_LOCK_*).",
  );
  const crashCfg = crashCfgOrThrow(
    "Crash on-chain config is required to build session lock args.",
  );

  const backendArgs = backendLockArgsHex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(backendArgs)) {
    throw new CellbetCkbError(
      "backendLockArgsHex must be 20 bytes (40 hex chars).",
      "UNKNOWN",
    );
  }
  const backendBlake160 = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    backendBlake160[i] = Number.parseInt(backendArgs.slice(i * 2, i * 2 + 2), 16);
  }

  const { houseHash } = await lockHashesForHouseAndPlatform(client, crashCfg);
  const typeCodeHashBytes = hex32ToBytes(crashCfg.typeScriptCodeHash);
  const typeHashByte = scriptHashTypeToLockArgsByte(crashCfg.typeScriptHashType);

  const userAddr = await signer.getRecommendedAddressObj();
  const userArgsHex = hexFrom(userAddr.script.args).replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(userArgsHex)) {
    throw new CellbetCkbError(
      "Wallet lock args must be 20-byte identity (default secp lock).",
      "UNKNOWN",
    );
  }
  const user20 = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    user20[i] = Number.parseInt(userArgsHex.slice(i * 2, i * 2 + 2), 16);
  }

  const lockArgs = encodeGameSessionLockArgsV1({
    userBlake160: user20,
    backendBlake160,
    houseLockHash: houseHash,
    crashTypeCodeHash: typeCodeHashBytes,
    crashTypeHashTypeByte: typeHashByte,
  });

  const lockScript = gameSessionLockScript(sessionCfg, lockArgs);

  const tx = Transaction.from({
    version: 0,
    cellDeps: [gameSessionCellDep(sessionCfg)],
    headerDeps: [],
    inputs: [],
    outputs: [],
    outputsData: [],
    witnesses: [],
  });

  tx.addOutput(
    {
      capacity: capacityShannons,
      lock: lockScript,
    },
    "0x",
  );

  try {
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer);
    return await signer.sendTransaction(tx);
  } catch (e) {
    throw mapCkbException(e);
  }
}

/**
 * User-signed withdrawal: consume the game-session cell and return CKB to the user's default lock.
 * Call `POST /crash/session/close` after broadcast so the API stops tracking the spent out-point.
 */
export async function buildWithdrawGameSessionCellTx(params: {
  signer: Signer;
  sessionTxHash: Hex;
  sessionOutputIndex: number;
}): Promise<Hex> {
  const { signer, sessionTxHash, sessionOutputIndex } = params;
  const client = signer.client;
  if (!clientMatchesExpectedNetwork(client)) {
    throw new CellbetCkbError(
      "Wallet is not on the network this app expects.",
      "WRONG_NETWORK",
    );
  }

  const sessionCfg = sessionCfgOrThrow(
    "Game session lock is not configured in env (NEXT_PUBLIC_GAME_SESSION_LOCK_*).",
  );

  const txHashNorm = sessionTxHash.startsWith("0x")
    ? sessionTxHash
    : (`0x${sessionTxHash}` as Hex);
  const outPoint = { txHash: txHashNorm, index: sessionOutputIndex };
  const live =
    (await client.getCellLive(outPoint, true, true)) ??
    (await client.getCellLiveNoCache(outPoint, true, true));
  if (!live) {
    throw new CellbetCkbError(
      "Game wallet cell is not live (wait for confirmation or check tx / index).",
      "UNKNOWN",
    );
  }

  const sessionLock = Script.from(live.cellOutput.lock);
  const cap = BigInt(live.cellOutput.capacity.toString());

  const cellInput = CellInput.from({ previousOutput: outPoint });
  await cellInput.completeExtraInfos(client);

  const userAddr = await signer.getRecommendedAddressObj();

  const tx = Transaction.from({
    version: 0,
    cellDeps: [gameSessionCellDep(sessionCfg)],
    headerDeps: [],
    inputs: [],
    outputs: [],
    outputsData: [],
    witnesses: [],
  });

  tx.addInput(cellInput);
  tx.addOutput(
    {
      capacity: cap,
      lock: userAddr.script,
    },
    "0x",
  );

  try {
    await tx.prepareSighashAllWitness(sessionLock, 65, client);
    await tx.completeFeeChangeToOutput(signer, 0, undefined, undefined, {
      shouldAddInputs: false,
    });
    return await signer.sendTransaction(tx);
  } catch (e) {
    throw mapCkbException(e);
  }
}

/** CKB amount string → shannons for session deposit UI. */
export function gameSessionCapacityFromCkbString(amountStr: string): bigint {
  return fixedPointFrom(amountStr.trim() || "0", 8);
}
