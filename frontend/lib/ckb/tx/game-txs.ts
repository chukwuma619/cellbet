import type { Signer } from "@ckb-ccc/core";

import { CellbetCkbError } from "../errors";

/**
 * On-chain bet placement (requires deployed `crash-settlement-split` cell deps + env).
 * Wire `NEXT_PUBLIC_CELLBET_*` after devnet deployment.
 */
export async function buildPlaceBetTx(params: {
  signer: Signer;
  roundId: bigint;
  stakeShannons: bigint;
}): Promise<never> {
  void params;
  throw new CellbetCkbError(
    "On-chain bet tx is not assembled in this build. Deploy scripts, set cell deps in env, then complete tx building.",
    "NOT_CONFIGURED",
  );
}

export async function buildCashOutTx(params: { signer: Signer; roundId: bigint }): Promise<never> {
  void params;
  throw new CellbetCkbError(
    "On-chain cash-out tx is not assembled in this build.",
    "NOT_CONFIGURED",
  );
}

export async function buildAnchorRoundTx(params: {
  signer: Signer;
  roundId: bigint;
  serverSeedUtf8: string;
}): Promise<never> {
  void params;
  throw new CellbetCkbError(
    "Anchor tx builder not wired. See contract/protocol/OPERATOR_ANCHOR.md and @cellbet/shared ckb helpers.",
    "NOT_CONFIGURED",
  );
}
