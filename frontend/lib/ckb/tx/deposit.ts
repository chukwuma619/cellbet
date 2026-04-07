import { Address, Transaction, type Hex, type Signer } from "@ckb-ccc/core";

import { clientMatchesExpectedNetwork } from "../config";
import { CellbetCkbError, mapCkbException } from "../errors";

/**
 * Send native CKB from the connected wallet to any CKB address (top up / “deposit”).
 * Completes inputs, then fees + change via `completeFeeBy`.
 */
export async function transferCkb(params: {
  signer: Signer;
  toAddress: string;
  amountShannons: bigint;
}): Promise<Hex> {
  const { signer, toAddress, amountShannons } = params;
  const client = signer.client;
  if (!clientMatchesExpectedNetwork(client)) {
    throw new CellbetCkbError(
      "Wallet is not on the network this app expects. Check NEXT_PUBLIC_CKB_NETWORK and RPC.",
      "WRONG_NETWORK",
    );
  }
  if (amountShannons <= BigInt(0)) {
    throw new CellbetCkbError("Amount must be positive.", "UNKNOWN");
  }

  const recipient = await Address.fromString(toAddress, client);

  const tx = Transaction.from({
    version: 0,
    cellDeps: [],
    headerDeps: [],
    inputs: [],
    outputs: [],
    outputsData: [],
    witnesses: [],
  });

  tx.addOutput(
    {
      capacity: amountShannons,
      lock: recipient.script,
    },
    "0x",
  );

  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer);

  try {
    return await signer.sendTransaction(tx);
  } catch (e) {
    throw mapCkbException(e);
  }
}
