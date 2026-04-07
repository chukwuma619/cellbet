import { ccc } from "@ckb-ccc/core";

/** Matches `NEXT_PUBLIC_CKB_NETWORK`. */
export type CkbNetworkId = "mainnet" | "testnet" | "devnet";

export function getExpectedCkbNetwork(): CkbNetworkId {
  const v = process.env.NEXT_PUBLIC_CKB_NETWORK?.toLowerCase();
  if (v === "mainnet" || v === "testnet" || v === "devnet") return v;
  return "testnet";
}

/**
 * Build a CCC JSON-RPC client for the configured network.
 * Set `NEXT_PUBLIC_CKB_RPC_URL` to override (e.g. local devnet).
 */
export function createConfiguredCkbClient(): ccc.Client {
  const rpc = process.env.NEXT_PUBLIC_CKB_RPC_URL?.trim();
  if (rpc) {
    const net = getExpectedCkbNetwork();
    if (net === "mainnet") {
      return new ccc.ClientPublicMainnet({ url: rpc });
    }
    return new ccc.ClientPublicTestnet({ url: rpc });
  }
  const net = getExpectedCkbNetwork();
  if (net === "mainnet") {
    return new ccc.ClientPublicMainnet();
  }
  return new ccc.ClientPublicTestnet();
}

/** True if wallet client appears to match expected network (prefix / URL heuristic). */
export function clientMatchesExpectedNetwork(client: ccc.Client): boolean {
  const expected = getExpectedCkbNetwork();
  const prefix = client.addressPrefix;
  if (expected === "mainnet") return prefix === "ckb";
  if (expected === "testnet" || expected === "devnet") {
    return prefix === "ckt";
  }
  return true;
}
