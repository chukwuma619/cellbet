export function getApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:3001"
  );
}

export async function fetchCrashState(): Promise<unknown> {
  const res = await fetch(`${getApiBaseUrl()}/crash/state`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load crash state");
  return res.json();
}

export type CrashWalletBalances = {
  onChainCkb: string;
  poolCkb: string;
  ckbBalance: string;
};

export async function fetchCrashCkbBalance(
  walletAddress: string,
): Promise<CrashWalletBalances> {
  const params = new URLSearchParams({
    walletAddress,
  });
  const res = await fetch(
    `${getApiBaseUrl()}/crash/balance?${params}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Failed to load balance");
  return res.json() as Promise<CrashWalletBalances>;
}

export async function postCrashDepositConfirm(body: {
  walletAddress: string;
  txHash: string;
  outputIndex?: number;
}): Promise<{ creditedCkb: string; alreadyCredited: boolean }> {
  const res = await fetch(`${getApiBaseUrl()}/crash/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!res.ok) {
    const msg = Array.isArray(data?.message)
      ? data.message.join(", ")
      : data?.message;
    throw new Error(msg || "Could not confirm deposit");
  }
  return data as { creditedCkb: string; alreadyCredited: boolean };
}

export async function fetchCrashRoundProof(roundId: string): Promise<unknown> {
  const res = await fetch(
    `${getApiBaseUrl()}/crash/rounds/${encodeURIComponent(roundId)}/proof`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Could not load round proof");
  return res.json();
}

export type PatternASessionPublicConfig = {
  backendLockArgsHex: string;
  gameSessionLockCodeHash: string;
  gameSessionLockHashType: string;
  gameSessionLockCellDep: {
    txHash: string;
    index: number;
    depType: string;
  };
  crashTypeScriptCodeHash: string;
  crashTypeScriptHashType: string;
} | null;

export async function fetchPatternASessionConfig(): Promise<PatternASessionPublicConfig> {
  const res = await fetch(`${getApiBaseUrl()}/crash/session/config`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json() as Promise<PatternASessionPublicConfig>;
}

export type GameSessionStatus =
  | { active: false }
  | {
      active: true;
      sessionTxHash: string;
      sessionOutputIndex: number;
      updatedAt: string;
    };

export async function fetchGameSessionStatus(
  walletAddress: string,
): Promise<GameSessionStatus> {
  const params = new URLSearchParams({ walletAddress });
  const res = await fetch(
    `${getApiBaseUrl()}/crash/session?${params}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    return { active: false };
  }
  return res.json() as Promise<GameSessionStatus>;
}

export async function postRegisterGameSession(body: {
  walletAddress: string;
  txHash: string;
  outputIndex: number;
}): Promise<{ ok: true }> {
  const res = await fetch(`${getApiBaseUrl()}/crash/session/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!res.ok) {
    const msg = Array.isArray(data?.message)
      ? data.message.join(", ")
      : data?.message;
    throw new Error(msg || "Could not register game session");
  }
  return data as { ok: true };
}

export async function postBet(body: {
  walletAddress: string;
  amount: number;
  clientSeed?: string;
  funding?: "escrow" | "balance" | "session";
  escrowTxHash?: string;
  escrowOutputIndex?: number;
}): Promise<unknown> {
  const res = await fetch(`${getApiBaseUrl()}/crash/bets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!res.ok) {
    const msg = Array.isArray(data?.message)
      ? data.message.join(", ")
      : data?.message;
    throw new Error(msg || "Could not place bet");
  }
  return data;
}

export async function postCashOut(
  walletAddress: string,
  betId?: string,
): Promise<unknown> {
  const res = await fetch(`${getApiBaseUrl()}/crash/cashout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress,
      ...(betId ? { betId } : {}),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!res.ok) {
    const msg = Array.isArray(data?.message)
      ? data.message.join(", ")
      : data?.message;
    throw new Error(msg || "Could not cash out");
  }
  return data;
}

export type CrashRoundHistoryItem = {
  id: string;
  roundKey: string;
  crashMultiplier: number | null;
  settledAt: string | null;
};

export type CrashRoundHistoryResponse = {
  rounds: CrashRoundHistoryItem[];
};

export async function fetchCrashRoundHistory(
  limit = 20,
): Promise<CrashRoundHistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(
    `${getApiBaseUrl()}/crash/history/rounds?${params}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Could not load round history");
  return res.json() as Promise<CrashRoundHistoryResponse>;
}

export type CrashBetHistoryItem = {
  betId: string;
  roundId: string;
  roundKey: string;
  roundPhase: string;
  amount: string;
  status: string;
  cashedOutAtMultiplier: string | null;
  profit: string | null;
  crashMultiplier: number | null;
  createdAt: string;
};

export type CrashBetHistoryResponse = {
  bets: CrashBetHistoryItem[];
};

export async function fetchCrashBetHistory(
  walletAddress: string,
  limit = 50,
): Promise<CrashBetHistoryResponse> {
  const params = new URLSearchParams({
    walletAddress,
    limit: String(limit),
  });
  const res = await fetch(`${getApiBaseUrl()}/crash/history/bets?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not load bet history");
  return res.json() as Promise<CrashBetHistoryResponse>;
}
