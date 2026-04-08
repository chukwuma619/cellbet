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

// Next inlines only static `process.env.NEXT_PUBLIC_*` — not `process.env[name]`.
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

export function getCrashOnChainConfigFromEnv(): CrashOnChainConfig {
  return {
    typeScriptCodeHash: req(
      process.env.NEXT_PUBLIC_CRASH_ROUND_TYPE_SCRIPT_CODE_HASH,
      "NEXT_PUBLIC_CRASH_ROUND_TYPE_SCRIPT_CODE_HASH",
    ) as Hex,
    typeScriptHashType: opt(
      process.env.NEXT_PUBLIC_CRASH_ROUND_TYPE_SCRIPT_HASH_TYPE,
      "data1",
    ) as HashType,
    cellDep: {
      outTxHash: req(
        process.env.NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_TX_HASH,
        "NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_TX_HASH",
      ) as Hex,
      outputIndex: Number.parseInt(
        req(
          process.env.NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_INDEX,
          "NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_INDEX",
        ),
        10,
      ),
      depType: opt(
        process.env.NEXT_PUBLIC_CRASH_ROUND_SCRIPT_CELL_DEP_TYPE,
        "code",
      ) as DepType,
    },
    houseCkbAddress: req(
      process.env.NEXT_PUBLIC_HOUSE_CKB_ADDRESS,
      "NEXT_PUBLIC_HOUSE_CKB_ADDRESS",
    ),
    platformCkbAddress: req(
      process.env.NEXT_PUBLIC_PLATFORM_CKB_ADDRESS,
      "NEXT_PUBLIC_PLATFORM_CKB_ADDRESS",
    ),
    feeBps: Number.parseInt(
      opt(process.env.NEXT_PUBLIC_CRASH_CASHOUT_FEE_BPS, "300"),
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

export function getCrashPoolDepositAddress(): string | null {
  const v = process.env.NEXT_PUBLIC_CRASH_POOL_DEPOSIT_CKB_ADDRESS?.trim();
  return v ?? null;
}
