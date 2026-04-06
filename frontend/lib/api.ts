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
  autoCashoutMultiplier?: number;
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
