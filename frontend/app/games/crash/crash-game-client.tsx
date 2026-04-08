"use client";

import { CKB_MIN_OCCUPIED_CAPACITY_SHANNONS } from "@cellbet/shared";
import { fixedPointFrom, fixedPointToString } from "@ckb-ccc/core";
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
  fetchCrashCkbBalance,
  postBet,
  postCashOut,
  postCrashDepositConfirm,
} from "@/lib/api";
import {
  getCrashPoolDepositAddress,
  isCrashOnChainConfigured,
} from "@/lib/ckb/crash-config";
import { CellbetCkbError, userMessageForCkbError } from "@/lib/ckb/errors";
import { buildPlaceBetTx } from "@/lib/ckb/tx/game-txs";

const MIN_ONCHAIN_STAKE_CKB = Number(
  fixedPointToString(CKB_MIN_OCCUPIED_CAPACITY_SHANNONS, 8),
);

type StakeSlot = "a" | "b";

export function CrashGameClient() {
  const { round, participants } = useCrashSocket();
  const { address, isConnected, openConnector } = useCkbAddress();
  const { signerInfo } = useCcc();
  const { shannons, displayShort, refresh } = useOnChainCkbBalance(address);
  const [poolShannons, setPoolShannons] = useState<bigint | null>(null);
  const [depositTx, setDepositTx] = useState("");
  const [depositOutIdx, setDepositOutIdx] = useState("0");
  const [depositBusy, setDepositBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [amountA, setAmountA] = useState("10");
  const [amountB, setAmountB] = useState("10");
  const [betIdA, setBetIdA] = useState<string | null>(null);
  const [betIdB, setBetIdB] = useState<string | null>(null);
  const [busyBetA, setBusyBetA] = useState(false);
  const [busyBetB, setBusyBetB] = useState(false);
  const [busyCashA, setBusyCashA] = useState(false);
  const [busyCashB, setBusyCashB] = useState(false);

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
  const poolDepositAddr = getCrashPoolDepositAddress();

  const refreshBalances = useCallback(async () => {
    await refresh();
    if (!address?.trim()) {
      setPoolShannons(null);
      return;
    }
    try {
      const b = await fetchCrashCkbBalance(address.trim());
      setPoolShannons(fixedPointFrom(b.poolCkb || "0", 8));
    } catch {
      setPoolShannons(null);
    }
  }, [address, refresh]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  function stakeAmountCovered(amountStr: string) {
    const need = fixedPointFrom(amountStr.trim() || "0", 8);
    if (poolShannons !== null && need <= poolShannons) return true;
    if (shannons !== null && need <= shannons) return true;
    return false;
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
    if (!ckbGameConfigured) {
      toast.error(
        "Crash requires NEXT_PUBLIC_CRASH_ROUND_* scripts and house/platform addresses in env.",
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
    if (!stakeAmountCovered(amountStr)) {
      toast.error("Insufficient pool or on-chain CKB");
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
      const stakeNeed = fixedPointFrom(amountStr.trim() || "0", 8);
      const usePool =
        poolShannons !== null && stakeNeed <= poolShannons;

      if (usePool) {
        const raw = await postBet({
          walletAddress: address,
          amount: n,
          funding: "balance",
        });
        applyBetIdFromResponse(slot, raw);
        await refreshBalances();
        toast.success("Bet placed");
        return;
      }

      const signer = signerInfo?.signer;
      if (!signer) {
        openConnector();
        return;
      }
      const stakeShannons = fixedPointFrom(amountStr.trim() || "0", 8);
      const escrowTxHash = await buildPlaceBetTx({
        signer,
        roundId: BigInt(chainRoundId),
        stakeShannons,
        serverSeedHashHex: seedHash,
      });
      const raw = await postBet({
        walletAddress: address,
        amount: n,
        funding: "escrow",
        escrowTxHash,
        escrowOutputIndex: 0,
      });
      applyBetIdFromResponse(slot, raw);
      await refreshBalances();
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
      await refreshBalances();
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
    phase === "betting" &&
    bettingLeftSec > 0 &&
    chainRoundReady &&
    commitReady;

  const canBetA =
    baseCanBet && stakeAmountCovered(amountA) && !betIdA && !busyBetA;
  const canBetB =
    baseCanBet && stakeAmountCovered(amountB) && !betIdB && !busyBetB;

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
        : !stakeAmountCovered(amountStr)
          ? "Insufficient balance"
          : !ckbGameConfigured
            ? "Configure CKB env"
            : !chainRoundReady
              ? "Syncing round…"
              : !commitReady
                ? "Anchoring…"
                : "Betting closed";
  }

  async function onConfirmDeposit() {
    if (!address?.trim()) {
      openConnector();
      return;
    }
    const h = depositTx.trim();
    if (!h) {
      toast.error("Enter the deposit transaction hash");
      return;
    }
    const idx = Number.parseInt(depositOutIdx.trim() || "0", 10);
    if (!Number.isFinite(idx) || idx < 0) {
      toast.error("Invalid output index");
      return;
    }
    setDepositBusy(true);
    try {
      const r = await postCrashDepositConfirm({
        walletAddress: address.trim(),
        txHash: h,
        outputIndex: idx,
      });
      await refreshBalances();
      toast.success(
        r.alreadyCredited
          ? "Deposit was already credited"
          : `Credited ${r.creditedCkb} CKB to your pool`,
      );
      setDepositTx("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deposit confirm failed");
    } finally {
      setDepositBusy(false);
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
                    {poolShannons !== null && (
                      <span className="mr-2">
                        Pool {fixedPointToString(poolShannons, 8)}
                      </span>
                    )}
                    {displayShort !== null && <span>L1 {displayShort}</span>}
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
                    {poolShannons !== null && (
                      <span className="mr-2">
                        Pool {fixedPointToString(poolShannons, 8)}
                      </span>
                    )}
                    {displayShort !== null && <span>L1 {displayShort}</span>}
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
        {poolDepositAddr ? (
          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pool balance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground leading-snug">
                Send CKB here, then submit the tx hash to credit your pool
                balance.
              </p>
              <p className="font-mono text-xs break-all rounded-md bg-muted/50 p-2">
                {poolDepositAddr}
              </p>
              <div className="space-y-1">
                <Label htmlFor="dep-tx">Deposit tx hash</Label>
                <Input
                  id="dep-tx"
                  className="font-mono text-xs"
                  placeholder="0x…"
                  value={depositTx}
                  onChange={(e) => setDepositTx(e.target.value)}
                  disabled={depositBusy}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dep-idx">Output index</Label>
                <Input
                  id="dep-idx"
                  inputMode="numeric"
                  value={depositOutIdx}
                  onChange={(e) => setDepositOutIdx(e.target.value)}
                  disabled={depositBusy}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={depositBusy || !isConnected}
                onClick={() => void onConfirmDeposit()}
              >
                {depositBusy ? "Confirming…" : "Confirm deposit"}
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <Card className="border-border/80 h-full">
          <CardContent className="pt-6 h-full">
            <CrashParticipantsTable participants={participants} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
