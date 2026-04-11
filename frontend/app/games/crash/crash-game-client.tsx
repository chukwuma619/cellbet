"use client";

import { CKB_MIN_OCCUPIED_CAPACITY_SHANNONS } from "@cellbet/shared";
import {
  fixedPointFrom,
  fixedPointToString,
  type Hex,
} from "@ckb-ccc/core";
import { useCcc } from "@ckb-ccc/connector-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { CrashParticipantsTable } from "@/components/crash/crash-participants-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCkbAddress } from "@/hooks/use-ckb-address";
import { useOnChainCkbBalance } from "@/hooks/use-on-chain-ckb-balance";
import { useCrashSocket } from "@/hooks/use-crash-socket";
import {
  fetchGameSessionStatus,
  fetchPatternASessionConfig,
  postBet,
  postCashOut,
  postCloseGameSession,
  postRegisterGameSession,
} from "@/lib/api";
import { isCrashOnChainConfigured } from "@/lib/ckb/crash-config";
import { CellbetCkbError, userMessageForCkbError } from "@/lib/ckb/errors";
import { isGameSessionLockConfigured } from "@/lib/ckb/game-session-config";
import {
  buildFundGameSessionCellTx,
  buildWithdrawGameSessionCellTx,
  gameSessionCapacityFromCkbString,
} from "@/lib/ckb/tx/game-session-txs";

const MIN_ONCHAIN_STAKE_CKB = Number(
  fixedPointToString(CKB_MIN_OCCUPIED_CAPACITY_SHANNONS, 8),
);

type StakeSlot = "a" | "b";

export function CrashGameClient() {
  const { round, participants } = useCrashSocket();
  const { address, isConnected, openConnector } = useCkbAddress();
  const { signerInfo } = useCcc();
  const { displayShort, refresh } = useOnChainCkbBalance(address);
  const [now, setNow] = useState(() => Date.now());
  const [amountA, setAmountA] = useState("10");
  const [amountB, setAmountB] = useState("10");
  const [betIdA, setBetIdA] = useState<string | null>(null);
  const [betIdB, setBetIdB] = useState<string | null>(null);
  const [busyBetA, setBusyBetA] = useState(false);
  const [busyBetB, setBusyBetB] = useState(false);
  const [busyCashA, setBusyCashA] = useState(false);
  const [busyCashB, setBusyCashB] = useState(false);
  const [sessionBackendArgsHex, setSessionBackendArgsHex] = useState<
    string | null
  >(null);
  const [sessionStatus, setSessionStatus] = useState<{
    active: boolean;
    sessionTxHash?: string;
    sessionOutputIndex?: number;
    capacityCkb?: string;
  }>({ active: false });
  const [sessionAmount, setSessionAmount] = useState("200");
  const [sessionFundBusy, setSessionFundBusy] = useState(false);
  const [sessionRegTx, setSessionRegTx] = useState("");
  const [sessionRegIdx, setSessionRegIdx] = useState("0");
  const [sessionRegBusy, setSessionRegBusy] = useState(false);
  const [sessionWithdrawBusy, setSessionWithdrawBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setBetIdA(null);
    setBetIdB(null);
  }, [round?.id]);

  useEffect(() => {
    if (!address || !round?.id) return;
    const mine = participants
      .filter(
        (p) =>
          p.ckbAddress === address &&
          p.roundId === round.id &&
          p.status === "pending",
      )
      .sort((a, b) => a.betId.localeCompare(b.betId));
    setBetIdA((prev) => prev ?? mine[0]?.betId ?? null);
    setBetIdB((prev) => prev ?? mine[1]?.betId ?? null);
  }, [participants, round?.id, address]);

  useEffect(() => {
    if (betIdA) {
      const p = participants.find((x) => x.betId === betIdA);
      if (p && p.status !== "pending") setBetIdA(null);
    }
  }, [participants, betIdA]);

  useEffect(() => {
    if (betIdB) {
      const p = participants.find((x) => x.betId === betIdB);
      if (p && p.status !== "pending") setBetIdB(null);
    }
  }, [participants, betIdB]);

  const phase = round?.phase ?? "…";
  const mult = round?.currentMultiplier ?? 1;
  const bettingLeftSec =
    round && phase === "betting"
      ? Math.max(0, (round.bettingEndsAt - now) / 1000)
      : 0;

  const ckbGameConfigured = isCrashOnChainConfigured();
  const patternAConfigured =
    isGameSessionLockConfigured() && Boolean(sessionBackendArgsHex?.trim());

  const refreshSessionForAddress = useCallback(async (addr: string) => {
    try {
      const s = await fetchGameSessionStatus(addr);
      if (s.active) {
        setSessionStatus({
          active: true,
          sessionTxHash: s.sessionTxHash,
          sessionOutputIndex: s.sessionOutputIndex,
          capacityCkb: s.capacityCkb,
        });
      } else {
        setSessionStatus({ active: false });
      }
    } catch {
      setSessionStatus({ active: false });
    }
  }, []);

  const refreshAfterChainAction = useCallback(async () => {
    await refresh();
    if (address?.trim()) await refreshSessionForAddress(address.trim());
  }, [address, refresh, refreshSessionForAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await fetchPatternASessionConfig();
      if (!cancelled && cfg?.backendLockArgsHex) {
        setSessionBackendArgsHex(cfg.backendLockArgsHex);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!address?.trim()) {
      setSessionStatus({ active: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await fetchGameSessionStatus(address.trim());
        if (cancelled) return;
        if (s.active) {
          setSessionStatus({
            active: true,
            sessionTxHash: s.sessionTxHash,
            sessionOutputIndex: s.sessionOutputIndex,
            capacityCkb: s.capacityCkb,
          });
        } else {
          setSessionStatus({ active: false });
        }
      } catch {
        if (!cancelled) setSessionStatus({ active: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  /** Active game wallet with enough on-chain capacity for the stake (when API reports capacity). */
  function sessionCoversStake(amountStr: string) {
    if (!sessionStatus.active) return false;
    const need = fixedPointFrom(amountStr.trim() || "0", 8);
    const capStr = sessionStatus.capacityCkb?.trim();
    if (capStr) {
      const cap = fixedPointFrom(capStr, 8);
      return need <= cap;
    }
    return true;
  }

  function applyBetIdFromResponse(slot: StakeSlot, raw: unknown) {
    const id = (raw as { betId?: string }).betId;
    if (typeof id === "string" && id.length > 0) {
      if (slot === "a") setBetIdA(id);
      else setBetIdB(id);
    }
  }

  async function onBet(slot: StakeSlot) {
    if (!address) {
      openConnector();
      return;
    }
    if (!ckbGameConfigured || !patternAConfigured) {
      toast.error(
        "Configure crash scripts, NEXT_PUBLIC_GAME_SESSION_LOCK_*, and server GAME_SESSION_* / GAME_SESSION_BACKEND_PRIVATE_KEY.",
      );
      return;
    }
    const amountStr = slot === "a" ? amountA : amountB;
    const setBusy = slot === "a" ? setBusyBetA : setBusyBetB;
    const existingId = slot === "a" ? betIdA : betIdB;
    if (existingId) {
      toast.error("This stake already has a bet for this round.");
      return;
    }
    const n = Number(amountStr);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (n < MIN_ONCHAIN_STAKE_CKB) {
      toast.error(
        `Stake must be at least ${MIN_ONCHAIN_STAKE_CKB} CKB (CKB cell minimum).`,
      );
      return;
    }
    if (!sessionStatus.active) {
      toast.error("Fund and register a game wallet (Pattern A) before betting.");
      return;
    }
    if (!sessionCoversStake(amountStr)) {
      toast.error("Game wallet balance is too low for this stake (or refresh after funding).");
      return;
    }
    setBusy(true);
    try {
      const chainRoundId = round?.chainRoundId?.trim();
      const seedHash = round?.serverSeedHash?.trim();
      if (!chainRoundId || !seedHash) {
        toast.error("Round data not ready — wait for the next betting window.");
        return;
      }
      const raw = await postBet({
        walletAddress: address,
        amount: n,
      });
      applyBetIdFromResponse(slot, raw);
      await refreshAfterChainAction();
      if (address?.trim()) await refreshSessionForAddress(address.trim());
      toast.success("Bet placed");
    } catch (e) {
      if (e instanceof CellbetCkbError) {
        toast.error(userMessageForCkbError(e));
      } else {
        toast.error(e instanceof Error ? e.message : "Bet failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onCashOut(slot: StakeSlot) {
    if (!address) return;
    const id = slot === "a" ? betIdA : betIdB;
    if (!id) return;
    const setBusy = slot === "a" ? setBusyCashA : setBusyCashB;
    setBusy(true);
    try {
      await postCashOut(address, id);
      await refreshAfterChainAction();
      if (slot === "a") setBetIdA(null);
      else setBetIdB(null);
      toast.success("Cashed out");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cash out failed");
    } finally {
      setBusy(false);
    }
  }

  const chainRoundReady = Boolean(
    round?.chainRoundId && round.chainRoundId.length > 0,
  );
  const commitReady = round?.commitAnchored === true;

  const baseCanBet =
    isConnected &&
    ckbGameConfigured &&
    patternAConfigured &&
    phase === "betting" &&
    bettingLeftSec > 0 &&
    chainRoundReady &&
    commitReady;

  const canBetA =
    baseCanBet &&
    sessionCoversStake(amountA) &&
    !betIdA &&
    !busyBetA;
  const canBetB =
    baseCanBet &&
    sessionCoversStake(amountB) &&
    !betIdB &&
    !busyBetB;

  const canCashOutA =
    isConnected &&
    phase === "running" &&
    mult > 0 &&
    Boolean(betIdA) &&
    !busyCashA;
  const canCashOutB =
    isConnected &&
    phase === "running" &&
    mult > 0 &&
    Boolean(betIdB) &&
    !busyCashB;

  function betButtonLabelFor(amountStr: string) {
    return baseCanBet
      ? "Bet"
      : phase !== "betting"
        ? "Wait"
        : !patternAConfigured || !ckbGameConfigured
          ? "Configure env"
          : !sessionStatus.active
            ? "Fund game wallet"
            : !sessionCoversStake(amountStr)
              ? "Low game wallet"
              : !chainRoundReady
                ? "Syncing round…"
                : !commitReady
                  ? "Anchoring…"
                  : "Betting closed";
  }

  async function onFundSession() {
    if (!address) {
      openConnector();
      return;
    }
    if (!ckbGameConfigured || !isGameSessionLockConfigured()) {
      toast.error(
        "Configure crash + NEXT_PUBLIC_GAME_SESSION_LOCK_* env and deploy the game-session-lock script.",
      );
      return;
    }
    if (!sessionBackendArgsHex?.trim()) {
      toast.error(
        "Server did not return session config. Set GAME_SESSION_BACKEND_PRIVATE_KEY on the API.",
      );
      return;
    }
    const signer = signerInfo?.signer;
    if (!signer) {
      openConnector();
      return;
    }
    const cap = gameSessionCapacityFromCkbString(sessionAmount);
    if (cap <= BigInt(0)) {
      toast.error("Enter a valid session deposit (CKB)");
      return;
    }
    setSessionFundBusy(true);
    try {
      const txHash = await buildFundGameSessionCellTx({
        signer,
        capacityShannons: cap,
        backendLockArgsHex: sessionBackendArgsHex.trim(),
      });
      const norm = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
      setSessionRegTx(norm.replace(/^0x/i, ""));
      await refreshAfterChainAction();
      try {
        await postRegisterGameSession({
          walletAddress: address.trim(),
          txHash: norm,
          outputIndex: 0,
        });
        const s = await fetchGameSessionStatus(address.trim());
        if (s.active) {
          setSessionStatus({
            active: true,
            sessionTxHash: s.sessionTxHash,
            sessionOutputIndex: s.sessionOutputIndex,
            capacityCkb: s.capacityCkb,
          });
        }
        toast.success(
          "Game wallet live — Pattern A bets no longer need a per-round wallet signature.",
        );
        setSessionRegTx("");
      } catch (regErr) {
        toast.error(
          regErr instanceof Error
            ? `${regErr.message} Use “Register session” below after the tx confirms (output index is usually 0).`
            : "Register manually below once the funding transaction confirms.",
        );
      }
    } catch (e) {
      if (e instanceof CellbetCkbError) {
        toast.error(userMessageForCkbError(e));
      } else {
        toast.error(e instanceof Error ? e.message : "Session fund failed");
      }
    } finally {
      setSessionFundBusy(false);
    }
  }

  async function onRegisterSession() {
    if (!address?.trim()) {
      openConnector();
      return;
    }
    const h = sessionRegTx.trim();
    if (!h) {
      toast.error("Enter the session funding transaction hash");
      return;
    }
    const idx = Number.parseInt(sessionRegIdx.trim() || "0", 10);
    if (!Number.isFinite(idx) || idx < 0) {
      toast.error("Invalid output index");
      return;
    }
    setSessionRegBusy(true);
    try {
      await postRegisterGameSession({
        walletAddress: address.trim(),
        txHash: h.startsWith("0x") ? h : `0x${h}`,
        outputIndex: idx,
      });
      const s = await fetchGameSessionStatus(address.trim());
      if (s.active) {
        setSessionStatus({
          active: true,
          sessionTxHash: s.sessionTxHash,
          sessionOutputIndex: s.sessionOutputIndex,
          capacityCkb: s.capacityCkb,
        });
      }
      toast.success("Game session registered — bets use Pattern A (no per-bet sign).");
      setSessionRegTx("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Register failed");
    } finally {
      setSessionRegBusy(false);
    }
  }

  async function onWithdrawSession() {
    if (!address?.trim()) {
      openConnector();
      return;
    }
    if (!sessionStatus.active || !sessionStatus.sessionTxHash) {
      toast.error("No active game wallet to withdraw.");
      return;
    }
    const signer = signerInfo?.signer;
    if (!signer) {
      openConnector();
      return;
    }
    setSessionWithdrawBusy(true);
    try {
      const h = (
        sessionStatus.sessionTxHash.startsWith("0x")
          ? sessionStatus.sessionTxHash
          : `0x${sessionStatus.sessionTxHash}`
      ) as Hex;
      await buildWithdrawGameSessionCellTx({
        signer,
        sessionTxHash: h,
        sessionOutputIndex: sessionStatus.sessionOutputIndex ?? 0,
      });
      await postCloseGameSession({ walletAddress: address.trim() });
      setSessionStatus({ active: false });
      toast.success("Game wallet withdrawn to your address — session cleared on the server.");
      await refreshAfterChainAction();
    } catch (e) {
      if (e instanceof CellbetCkbError) {
        toast.error(userMessageForCkbError(e));
      } else {
        toast.error(e instanceof Error ? e.message : "Withdraw failed");
      }
    } finally {
      setSessionWithdrawBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      <div className="space-y-6 col-span-2 order-1 md:order-2">
        <div className="relative flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-border bg-muted/30">
          {phase === "betting" && (
            <div className="text-center">
              <p className="text-muted-foreground text-sm">Next round in</p>
              <p className="font-mono text-6xl font-semibold tabular-nums">
                {bettingLeftSec.toFixed(1)}s
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Place your bet before the round starts
              </p>
            </div>
          )}
          {phase === "locked" && (
            <p className="text-muted-foreground">Bets closed — starting…</p>
          )}
          {(phase === "running" ||
            phase === "crashed" ||
            phase === "settled") && (
            <>
              <p
                className="font-mono text-7xl font-bold tabular-nums tracking-tight sm:text-8xl"
                style={{
                  color:
                    phase === "crashed" || phase === "settled"
                      ? "var(--destructive)"
                      : "var(--primary)",
                }}
              >
                {mult.toFixed(2)}×
              </p>
              {phase === "crashed" && round?.crashMultiplier !== undefined && (
                <p className="text-destructive mt-4 text-sm">
                  Crashed at {round.crashMultiplier.toFixed(2)}×
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-1  md:grid-cols-2 gap-2">
          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Stake 1</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isConnected && (
                <p className="text-muted-foreground text-sm">
                  Connect a CKB wallet to place bets.
                </p>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="stake-a">Amount (CKB)</Label>
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                    {sessionStatus.active && sessionStatus.capacityCkb ? (
                      <span className="mr-2">
                        Wallet {sessionStatus.capacityCkb}
                      </span>
                    ) : null}
                    {displayShort !== null ? (
                      <span>L1 {displayShort}</span>
                    ) : null}
                  </span>
                </div>

                <Input
                  id="stake-a"
                  inputMode="decimal"
                  value={amountA}
                  onChange={(e) => setAmountA(e.target.value)}
                  disabled={
                    !isConnected || phase !== "betting" || bettingLeftSec <= 0
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={!canBetA || busyBetA}
                  onClick={() => void onBet("a")}
                >
                  {betButtonLabelFor(amountA)}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!canCashOutA || busyCashA}
                  onClick={() => void onCashOut("a")}
                >
                  Cash out
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Stake 2</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isConnected && (
                <p className="text-muted-foreground text-sm">
                  Connect a CKB wallet to place bets.
                </p>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="stake-b">Amount (CKB)</Label>
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                    {sessionStatus.active && sessionStatus.capacityCkb ? (
                      <span className="mr-2">
                        Wallet {sessionStatus.capacityCkb}
                      </span>
                    ) : null}
                    {displayShort !== null ? (
                      <span>L1 {displayShort}</span>
                    ) : null}
                  </span>
                </div>

                <Input
                  id="stake-b"
                  inputMode="decimal"
                  value={amountB}
                  onChange={(e) => setAmountB(e.target.value)}
                  disabled={
                    !isConnected || phase !== "betting" || bettingLeftSec <= 0
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={!canBetB || busyBetB}
                  onClick={() => void onBet("b")}
                >
                  {betButtonLabelFor(amountB)}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!canCashOutB || busyCashB}
                  onClick={() => void onCashOut("b")}
                >
                  Cash out
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="col-span-1 order-2 md:order-1 space-y-3">
        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Game wallet (Pattern A)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!patternAConfigured ? (
              <p className="text-destructive text-xs leading-snug">
                Set NEXT_PUBLIC_GAME_SESSION_LOCK_* on the app and
                GAME_SESSION_BACKEND_PRIVATE_KEY plus GAME_SESSION_LOCK_* on the
                API so GET /crash/session/config returns backend lock args.
              </p>
            ) : (
              <p className="text-muted-foreground leading-snug">
                One signature creates the game-wallet cell. The lock only allows
                the server to co-sign spends into crash escrow; bets do not open
                your wallet. Use L1 CKB only to fund or withdraw this cell.
              </p>
            )}
              {sessionStatus.active ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    On-chain balance ≈{" "}
                    <span className="font-mono text-foreground">
                      {sessionStatus.capacityCkb ?? "…"} CKB
                    </span>
                  </p>
                  <p className="font-mono break-all">
                    Out-point{" "}
                    {sessionStatus.sessionTxHash
                      ? `${sessionStatus.sessionTxHash}:${String(sessionStatus.sessionOutputIndex ?? 0)}`
                      : "—"}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No active session</p>
              )}
              <div className="space-y-1">
                <Label htmlFor="sess-amt">Session deposit (CKB)</Label>
                <Input
                  id="sess-amt"
                  inputMode="decimal"
                  value={sessionAmount}
                  onChange={(e) => setSessionAmount(e.target.value)}
                  disabled={
                    sessionFundBusy || !isConnected || !patternAConfigured
                  }
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={
                  sessionFundBusy || !isConnected || !patternAConfigured
                }
                onClick={() => void onFundSession()}
              >
                {sessionFundBusy ? "Signing…" : "Fund session cell"}
              </Button>
              <div className="space-y-1">
                <Label htmlFor="sess-tx">Funding tx hash</Label>
                <Input
                  id="sess-tx"
                  className="font-mono text-xs"
                  placeholder="0x…"
                  value={sessionRegTx}
                  onChange={(e) => setSessionRegTx(e.target.value)}
                  disabled={sessionRegBusy || !patternAConfigured}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sess-idx">Output index</Label>
                <Input
                  id="sess-idx"
                  inputMode="numeric"
                  value={sessionRegIdx}
                  onChange={(e) => setSessionRegIdx(e.target.value)}
                  disabled={sessionRegBusy || !patternAConfigured}
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={
                  sessionRegBusy || !isConnected || !patternAConfigured
                }
                onClick={() => void onRegisterSession()}
              >
                {sessionRegBusy ? "Registering…" : "Register session"}
              </Button>
              {sessionStatus.active ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={sessionWithdrawBusy || !isConnected}
                  onClick={() => void onWithdrawSession()}
                >
                  {sessionWithdrawBusy
                    ? "Signing withdraw…"
                    : "Withdraw game wallet (sign once)"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        <Card className="border-border/80 h-full">
          <CardContent className="pt-6 h-full">
            <CrashParticipantsTable participants={participants} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
