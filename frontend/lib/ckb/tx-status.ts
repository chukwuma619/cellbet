import type { Client, ClientTransactionResponse } from "@ckb-ccc/core";

export type TxConfirmStatus =
  | { stage: "pending" | "confirmed"; confirmations: number; tx?: ClientTransactionResponse };

export async function waitForConfirmations(
  client: Client,
  txHash: string,
  confirmations = 1,
  timeoutMs = 120_000,
  intervalMs = 2000,
): Promise<ClientTransactionResponse | undefined> {
  return client.waitTransaction(txHash, confirmations, timeoutMs, intervalMs);
}
