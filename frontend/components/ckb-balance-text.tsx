"use client";

import { useOnChainCkbBalance } from "@/hooks/use-on-chain-ckb-balance";

type CkbBalanceTextProps = {
  address: string;
  className?: string;
};

export function CkbBalanceText({ address, className }: CkbBalanceTextProps) {
  const { displayShort } = useOnChainCkbBalance(address);

  return (
    <span
      className={className}
      title={displayShort ?? undefined}
    >
      {displayShort ?? "…"}
    </span>
  );
}
