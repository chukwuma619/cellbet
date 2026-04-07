"use client";

import { useCcc } from "@ckb-ccc/connector-react";
import type { Client } from "@ckb-ccc/core";
import { useMemo } from "react";

/** CCC `Client` from the connector (same RPC the wallet uses). */
export function useCkbClient(): Client | null {
  const { client } = useCcc();
  return useMemo(() => client ?? null, [client]);
}
