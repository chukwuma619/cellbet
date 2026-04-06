"use client";

import { useCcc } from "@ckb-ccc/connector-react";
import { useEffect, useState } from "react";

export function useCkbAddress() {
  const { signerInfo, open, disconnect } = useCcc();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!signerInfo?.signer) {
        setAddress(null);
        return;
      }
      try {
        const addrs = await signerInfo.signer.getAddresses();
        if (!cancelled && addrs[0]) setAddress(addrs[0]);
        else if (!cancelled) setAddress(null);
      } catch {
        if (!cancelled) setAddress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signerInfo]);

  return {
    address,
    openConnector: open,
    disconnect,
    isConnected: Boolean(address),
  };
}
