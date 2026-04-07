"use client";

import type { CkbNetworkId } from "@/lib/ckb/config";
import { explorerTxUrl } from "@/lib/ckb/explorer";

export function TxExplorerLink(props: {
  network: CkbNetworkId;
  txHash: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { network, txHash, children, className } = props;
  const href = explorerTxUrl(network, txHash);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children ?? "View on explorer"}
    </a>
  );
}
