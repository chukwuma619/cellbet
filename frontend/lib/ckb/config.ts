import { ccc } from "@ckb-ccc/core";

export type CkbNetworkId = "mainnet" | "testnet" | "devnet";

export function getExpectedCkbNetwork(): CkbNetworkId {
  const v = process.env.NEXT_PUBLIC_CKB_NETWORK?.toLowerCase();
  if (v === "mainnet" || v === "testnet" || v === "devnet") return v;
  return "testnet";
}

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

export function clientMatchesExpectedNetwork(client: ccc.Client): boolean {
  const expected = getExpectedCkbNetwork();
  const prefix = client.addressPrefix;
  if (expected === "mainnet") return prefix === "ckb";
  if (expected === "testnet" || expected === "devnet") {
    return prefix === "ckt";
  }
  return true;
}
