import type { CkbNetworkId } from "./config";

const DEFAULT_MAINNET = "https://explorer.nervos.org";
const DEFAULT_TESTNET = "https://testnet.explorer.nervos.org";

function baseUrl(network: CkbNetworkId): string {
  const override = process.env.NEXT_PUBLIC_CKB_EXPLORER_BASE?.replace(/\/$/, "");
  if (override) return override;
  if (network === "mainnet") return DEFAULT_MAINNET;
  return DEFAULT_TESTNET;
}

export function explorerTxUrl(network: CkbNetworkId, txHash: string): string {
  const h = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${baseUrl(network)}/transaction/${h}`;
}

export function explorerAddressUrl(network: CkbNetworkId, address: string): string {
  return `${baseUrl(network)}/address/${encodeURIComponent(address)}`;
}
