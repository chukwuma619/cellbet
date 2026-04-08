"use client";

import { CKB_MIN_OCCUPIED_CAPACITY_SHANNONS } from "@cellbet/shared";
import { fixedPointFrom, fixedPointToString } from "@ckb-ccc/core";
import { useCcc } from "@ckb-ccc/connector-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCkbAddress } from "@/hooks/use-ckb-address";
import { useOnChainCkbBalance } from "@/hooks/use-on-chain-ckb-balance";
import { CrashParticipantsTable } from "@/components/crash/crash-participants-table";
import { useCrashSocket } from "@/hooks/use-crash-socket";
import { postBet, postCashOut } from "@/lib/api";
import { isCrashOnChainConfigured } from "@/lib/ckb/crash-config";
import { CellbetCkbError, userMessageForCkbError } from "@/lib/ckb/errors";
import { buildPlaceBetTx } from "@/lib/ckb/tx/game-txs";

const MIN_ONCHAIN_STAKE_CKB = Number(
  fixedPointToString(CKB_MIN_OCCUPIED_CAPACITY_SHANNONS, 8),
);

export function CrashGameClient() {
  const { round, participants } = useCrashSocket();
  const { address, isConnected, openConnector } = useCkbAddress();
  const { signerInfo } = useCcc();
  const { shannons, displayShort, refresh } = useOnChainCkbBalance(address);
  const [now, setNow] = useState(() => Date.now());
  const [amount, setAmount] = useState("10");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const phase = round?.phase ?? "…";
  const mult = round?.currentMultiplier ?? 1;
  const bettingLeftSec =
    round && phase === "betting"
      ? Math.max(0, (round.bettingEndsAt - now) / 1000)
      : 0;

  const ckbGameConfigured = isCrashOnChainConfigured();

  async function onBet() {
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
    const n = Number(amount);
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
      fixedPointFrom(amount.trim() || "0", 8) > shannons
    ) {
      toast.error("Insufficient on-chain CKB balance");
      return;
    }
    setSubmitting(true);
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
      const stakeShannons = fixedPointFrom(amount.trim() || "0", 8);
      const escrowTxHash = await buildPlaceBetTx({
        signer,
        roundId: BigInt(chainRoundId),
        stakeShannons,
        serverSeedHashHex: seedHash,
      });
      await postBet({
        walletAddress: address,
        amount: n,
        escrowTxHash,
        escrowOutputIndex: 0,
      });
      await refresh();
      toast.success("Bet placed");
    } catch (e) {
      if (e instanceof CellbetCkbError) {
        toast.error(userMessageForCkbError(e));
      } else {
        toast.error(e instanceof Error ? e.message : "Bet failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onCashOut() {
    if (!address) return;
    setSubmitting(true);
    try {
      await postCashOut(address);
      await refresh();
      toast.success("Cashed out");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cash out failed");
    } finally {
      setSubmitting(false);
    }
  }

  const balanceOk =
    shannons === null ||
    fixedPointFrom(amount.trim() || "0", 8) <= shannons;
  const chainRoundReady = Boolean(
    round?.chainRoundId && round.chainRoundId.length > 0,
  );
  const commitReady = round?.commitAnchored === true;
  const canBet =
    isConnected &&
    ckbGameConfigured &&
    phase === "betting" &&
    bettingLeftSec > 0 &&
    balanceOk &&
    chainRoundReady &&
    commitReady;
  const canCashOut =
    isConnected && phase === "running" && mult > 0 && !submitting;

  const stakeEscrowHint = (
    <>
      <p className="text-muted-foreground text-xs">
        You sign a CKB transaction that locks your stake in an escrow cell (min.{" "}
        {MIN_ONCHAIN_STAKE_CKB} CKB). Betting unlocks after this round is anchored
        on-chain.
      </p>
      {phase === "betting" &&
        chainRoundReady &&
        !commitReady &&
        bettingLeftSec > 0 && (
          <p className="text-amber-600 dark:text-amber-500 text-xs">
            Waiting for on-chain commitment…
          </p>
        )}
    </>
  );

  const betButtonLabel = canBet
    ? "Bet"
    : phase !== "betting"
      ? "Wait"
      : shannons !== null && !balanceOk
        ? "Insufficient balance"
        : !ckbGameConfigured
          ? "Configure CKB env"
          : !chainRoundReady
            ? "Syncing round…"
            : !commitReady
              ? "Anchoring…"
              : "Betting closed";

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
            <CardContent className="space-y-4">
              {!isConnected && (
                <p className="text-muted-foreground text-sm">
                  Connect a CKB wallet to place bets.
                </p>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="stake-a">Stake (CKB)</Label>
                  {displayShort !== null && (
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {displayShort}
                    </span>
                  )}
                </div>
                {stakeEscrowHint}
                <Input
                  id="stake-a"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={
                    !isConnected || phase !== "betting" || bettingLeftSec <= 0
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={!canBet || submitting}
                  onClick={() => void onBet()}
                >
                  {betButtonLabel}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!canCashOut}
                  onClick={() => void onCashOut()}
                >
                  Cash out
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              {!isConnected && (
                <p className="text-muted-foreground text-sm">
                  Connect a CKB wallet to place bets.
                </p>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="stake-b">Stake (CKB)</Label>
                  {displayShort !== null && (
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {displayShort}
                    </span>
                  )}
                </div>
                {stakeEscrowHint}
                <Input
                  id="stake-b"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={
                    !isConnected || phase !== "betting" || bettingLeftSec <= 0
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={!canBet || submitting}
                  onClick={() => void onBet()}
                >
                  {betButtonLabel}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!canCashOut}
                  onClick={() => void onCashOut()}
                >
                  Cash out
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <p className="text-muted-foreground text-center text-xs">
          On settlement, a 3% platform fee is taken from the gross cash-out (stake × multiplier)
          before you receive winnings; losses send the full stake to the house with no fee.
        </p>
      </div>

      <div className="col-span-1 order-2 md:order-1">
        <Card className="border-border/80">
          <CardContent className="pt-6">
            <CrashParticipantsTable participants={participants} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
