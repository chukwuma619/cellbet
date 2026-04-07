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

/** Settled-round commit-reveal proof (same checks as client-side `verifyCrashRound`). */
export async function fetchCrashRoundProof(roundId: string): Promise<unknown> {
  const res = await fetch(
    `${getApiBaseUrl()}/crash/rounds/${encodeURIComponent(roundId)}/proof`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Could not load round proof");
  return res.json();
}

export async function postBet(body: {
  walletAddress: string;
  amount: number;
  /** Optional user entropy (§4.9); max 256 chars. */
  clientSeed?: string;
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

export async function postCashOut(walletAddress: string): Promise<unknown> {
  const res = await fetch(`${getApiBaseUrl()}/crash/cashout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
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
