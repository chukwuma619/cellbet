import type { DepType, HashType, Hex } from "@ckb-ccc/core";

export type CrashRoundCellDepConfig = {
  outTxHash: Hex;
  outputIndex: number;
  depType: DepType;
};

export type CrashOnChainConfig = {
  typeScriptCodeHash: Hex;
  typeScriptHashType: HashType;
  cellDep: CrashRoundCellDepConfig;
  houseCkbAddress: string;
  platformCkbAddress: string;
  feeBps: number;
};

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing ${name}`);
  }
  return v;
}

function opt(name: string, defaultVal: string): string {
  return process.env[name]?.trim() ?? defaultVal;
}

export function getCrashOnChainConfigFromEnv(): CrashOnChainConfig {
  return {
    typeScriptCodeHash: req("NEXT_PUBLIC_CRASH_ROUND_TYPE_SCRIPT_CODE_HASH") as Hex,
    typeScriptHashType: opt(
      "NEXT_PUBLIC_CRASH_ROUND_TYPE_SCRIPT_HASH_TYPE",
      "data1",
    ) as HashType,
    cellDep: {
      outTxHash: req("NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_TX_HASH") as Hex,
      outputIndex: Number.parseInt(
        req("NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_INDEX"),
        10,
      ),
      depType: opt("NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_TYPE", "code") as DepType,
    },
    houseCkbAddress: req("NEXT_PUBLIC_HOUSE_CKB_ADDRESS"),
    platformCkbAddress: req("NEXT_PUBLIC_PLATFORM_CKB_ADDRESS"),
    feeBps: Number.parseInt(
      opt("NEXT_PUBLIC_CRASH_CASHOUT_FEE_BPS", "300"),
      10,
    ),
  };
}

export function isCrashOnChainConfigured(): boolean {
  try {
    getCrashOnChainConfigFromEnv();
    return true;
  } catch {
    return false;
  }
}
