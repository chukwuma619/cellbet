"use client";

import { CKB_MIN_OCCUPIED_CAPACITY_SHANNONS } from "@cellbet/shared";
import { fixedPointFrom, fixedPointToString } from "@ckb-ccc/core";
import { useCcc } from "@ckb-ccc/connector-react";
import { useEffect, useState } from "react";
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
import { postBet, postCashOut } from "@/lib/api";
import { isCrashOnChainConfigured } from "@/lib/ckb/crash-config";
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

  function balanceOkFor(amountStr: string) {
    return (
      shannons === null ||
      fixedPointFrom(amountStr.trim() || "0", 8) <= shannons
    );
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
    if (
      shannons !== null &&
      fixedPointFrom(amountStr.trim() || "0", 8) > shannons
    ) {
      toast.error("Insufficient on-chain CKB balance");
      return;
    }
    setBusy(true);
    try {
      const signer = signerInfo?.signer;
      if (!signer) {
        openConnector();
        return;
      }
      const chainRoundId = round?.chainRoundId?.trim();
      const seedHash = round?.serverSeedHash?.trim();
      if (!chainRoundId || !seedHash) {
        toast.error("Round data not ready — wait for the next betting window.");
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
        escrowTxHash,
        escrowOutputIndex: 0,
      });
      const placed = raw as { betId?: string };
      if (typeof placed.betId === "string" && placed.betId.length > 0) {
        if (slot === "a") setBetIdA(placed.betId);
        else setBetIdB(placed.betId);
      }
      await refresh();
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
      await refresh();
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
    baseCanBet && balanceOkFor(amountA) && !betIdA && !busyBetA;
  const canBetB =
    baseCanBet && balanceOkFor(amountB) && !betIdB && !busyBetB;

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
        : shannons !== null && !balanceOkFor(amountStr)
          ? "Insufficient balance"
          : !ckbGameConfigured
            ? "Configure CKB env"
            : !chainRoundReady
              ? "Syncing round…"
              : !commitReady
                ? "Anchoring…"
                : "Betting closed";
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
                  {displayShort !== null && (
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {displayShort}
                    </span>
                  )}
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
                  {displayShort !== null && (
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {displayShort}
                    </span>
                  )}
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

      <div className="col-span-1 order-2 md:order-1">
        <Card className="border-border/80 h-full">
          <CardContent className="pt-6 h-full">
            <CrashParticipantsTable participants={participants} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
