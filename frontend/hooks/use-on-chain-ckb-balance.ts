"use client";

import { Address, fixedPointToString } from "@ckb-ccc/core";
import { useCallback, useEffect, useState } from "react";

import { useCkbClient } from "@/hooks/use-ckb-client";

/**
 * Live CKB layer-1 balance for the connected wallet (matches on-chain state, including sends/receives).
 */
export function useOnChainCkbBalance(address: string | null | undefined) {
  const client = useCkbClient();
  const [shannons, setShannons] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !address?.trim()) {
      setShannons(null);
      return;
    }
    try {
      const parsed = await Address.fromString(address.trim(), client);
      const n = await client.getBalanceSingle(parsed.script);
      setShannons(n);
    } catch {
      setShannons(null);
    }
  }, [address, client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!client || !address?.trim()) {
        if (!cancelled) setShannons(null);
        return;
      }
      try {
        const parsed = await Address.fromString(address.trim(), client);
        const n = await client.getBalanceSingle(parsed.script);
        if (!cancelled) setShannons(n);
      } catch {
        if (!cancelled) setShannons(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, client]);

  const displayShort =
    shannons === null ? null : `${fixedPointToString(shannons, 8)} CKB`;

  return { shannons, displayShort, refresh };
}
