import {
  Address,
  Transaction,
  hexFrom,
  type Hex,
  type Signer,
} from "@ckb-ccc/core";
import {
  CKB_MIN_OCCUPIED_CAPACITY_SHANNONS,
  encodeCrashCommitCellDataV1,
  sha256BytesUtf8,
} from "@cellbet/shared";

import { clientMatchesExpectedNetwork } from "../config";
import {
  getCrashOnChainConfigFromEnv,
  type CrashOnChainConfig,
} from "../crash-config";
import { crashRoundCellDep, crashRoundTypeScript } from "../crash-scripts";
import { CellbetCkbError, mapCkbException } from "../errors";

function crashCfgOrThrow(message: string): CrashOnChainConfig {
  try {
    return getCrashOnChainConfigFromEnv();
  } catch {
    throw new CellbetCkbError(message, "NOT_CONFIGURED");
  }
}

export async function buildAnchorRoundTx(params: {
  signer: Signer;
  roundId: bigint;
  serverSeedUtf8: string;
}): Promise<Hex> {
  const { signer, roundId, serverSeedUtf8 } = params;
  const client = signer.client;
  if (!clientMatchesExpectedNetwork(client)) {
    throw new CellbetCkbError(
      "Wallet is not on the network this app expects.",
      "WRONG_NETWORK",
    );
  }

  const cfg = crashCfgOrThrow(
    "On-chain crash scripts are not configured (env).",
  );

  const commitment = sha256BytesUtf8(serverSeedUtf8);
  const data = encodeCrashCommitCellDataV1(roundId, commitment);
  const typeScript = crashRoundTypeScript(cfg);
  const houseAddr = await Address.fromString(cfg.houseCkbAddress, client);

  const tx = Transaction.from({
    version: 0,
    cellDeps: [crashRoundCellDep(cfg)],
    headerDeps: [],
    inputs: [],
    outputs: [],
    outputsData: [],
    witnesses: [],
  });

  tx.addOutput(
    {
      capacity: CKB_MIN_OCCUPIED_CAPACITY_SHANNONS,
      lock: houseAddr.script,
      type: typeScript,
    },
    hexFrom(data),
  );

  try {
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer);
    return await signer.sendTransaction(tx);
  } catch (e) {
    throw mapCkbException(e);
  }
}

export async function buildCashOutTx(_params: {
  signer: Signer;
  roundId: bigint;
}): Promise<never> {
  void _params;
  throw new CellbetCkbError(
    "Crash cash-out does not use a user-built CKB transaction. The house settles the escrow on-chain after cash-out.",
    "NOT_CONFIGURED",
  );
}
