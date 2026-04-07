"use client";

import type { Client, ClientTransactionResponse } from "@ckb-ccc/core";
import { useCallback, useEffect, useState } from "react";

import { waitForConfirmations } from "@/lib/ckb/tx-status";

export function useTxConfirmations(
  client: Client | null,
  txHash: string | null,
  requiredConfirmations = 1,
) {
  const [status, setStatus] = useState<"idle" | "pending" | "confirmed" | "error">("idle");
  const [result, setResult] = useState<ClientTransactionResponse | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !txHash) {
      setStatus("idle");
      setResult(undefined);
      setError(null);
      return;
    }
    setStatus("pending");
    setError(null);
    try {
      const r = await waitForConfirmations(client, txHash, requiredConfirmations);
      setResult(r);
      setStatus(r?.status === "committed" ? "confirmed" : "pending");
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setStatus("error");
    }
  }, [client, txHash, requiredConfirmations]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  return { status, result, error, refresh };
}
