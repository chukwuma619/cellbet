import type { Cell, Client, Script } from "@ckb-ccc/core";

/**
 * Iterate live cells with a given **type script** (e.g. deployed Cellbet script).
 * Uses the node/indexer RPC via CCC `findCellsByType` (no separate indexer binary required).
 */
export async function* iterateCellsByTypeScript(
  client: Client,
  typeScript: Script,
  options?: { withData?: boolean; limit?: number },
): AsyncGenerator<Cell> {
  const withData = options?.withData ?? true;
  const limit = options?.limit ?? 100;
  let count = 0;
  for await (const cell of client.findCellsByType(typeScript, withData, "desc", limit)) {
    yield cell;
    count += 1;
    if (count >= limit) break;
  }
}

/** Tip block number as bigint (best-effort sync health). */
export async function getTipBlockNumber(client: Client): Promise<bigint> {
  const tip = await client.getTip();
  return BigInt(tip.toString());
}
