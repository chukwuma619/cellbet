import type { DepType, HashType, Hex } from "@ckb-ccc/core";

export type GameSessionLockCellDepConfig = {
  outTxHash: Hex;
  outputIndex: number;
  depType: DepType;
};

export type GameSessionLockOnChainConfig = {
  codeHash: Hex;
  hashType: HashType;
  cellDep: GameSessionLockCellDepConfig;
};

function req(value: string | undefined, name: string): string {
  const v = value?.trim();
  if (!v) {
    throw new Error(`Missing ${name}`);
  }
  return v;
}

function opt(value: string | undefined, defaultVal: string): string {
  return value?.trim() ?? defaultVal;
}

export function getGameSessionLockConfigFromEnv(): GameSessionLockOnChainConfig {
  return {
    codeHash: req(
      process.env.NEXT_PUBLIC_GAME_SESSION_LOCK_CODE_HASH,
      "NEXT_PUBLIC_GAME_SESSION_LOCK_CODE_HASH",
    ) as Hex,
    hashType: opt(
      process.env.NEXT_PUBLIC_GAME_SESSION_LOCK_HASH_TYPE,
      "data1",
    ) as HashType,
    cellDep: {
      outTxHash: req(
        process.env.NEXT_PUBLIC_GAME_SESSION_LOCK_SCRIPT_CELL_DEP_TX_HASH,
        "NEXT_PUBLIC_GAME_SESSION_LOCK_SCRIPT_CELL_DEP_TX_HASH",
      ) as Hex,
      outputIndex: Number.parseInt(
        req(
          process.env.NEXT_PUBLIC_GAME_SESSION_LOCK_SCRIPT_CELL_DEP_INDEX,
          "NEXT_PUBLIC_GAME_SESSION_LOCK_SCRIPT_CELL_DEP_INDEX",
        ),
        10,
      ),
      depType: opt(
        process.env.NEXT_PUBLIC_GAME_SESSION_LOCK_SCRIPT_CELL_DEP_TYPE,
        "code",
      ) as DepType,
    },
  };
}

export function isGameSessionLockConfigured(): boolean {
  try {
    getGameSessionLockConfigFromEnv();
    return true;
  } catch {
    return false;
  }
}
