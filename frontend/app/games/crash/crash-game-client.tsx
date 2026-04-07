"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCkbAddress } from "@/hooks/use-ckb-address";
import { CrashParticipantsTable } from "@/components/crash/crash-participants-table";
import { useCrashSocket } from "@/hooks/use-crash-socket";
import { postBet, postCashOut } from "@/lib/api";

export function CrashGameClient() {
  const { round, participants } = useCrashSocket();
  const { address, isConnected, openConnector } = useCkbAddress();
  const [now, setNow] = useState(() => Date.now());
  const [amount, setAmount] = useState("10");
  const [hasOpenBet, setHasOpenBet] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setHasOpenBet(false);
  }, [round?.id]);

  const phase = round?.phase ?? "…";
  const mult = round?.currentMultiplier ?? 1;
  const bettingLeftSec =
    round && phase === "betting"
      ? Math.max(0, (round.bettingEndsAt - now) / 1000)
      : 0;

  async function onBet() {
    if (!address) {
      openConnector();
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      await postBet({
        walletAddress: address,
        amount: n,
      });
      setHasOpenBet(true);
      toast.success("Bet placed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onCashOut() {
    if (!address) return;
    setSubmitting(true);
    try {
      await postCashOut(address);
      setHasOpenBet(false);
      toast.success("Cashed out");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cash out failed");
    } finally {
      setSubmitting(false);
    }
  }

  const canBet = isConnected && phase === "betting" && bettingLeftSec > 0;
  const canCashOut =
    isConnected && phase === "running" && hasOpenBet && mult > 0 && !submitting;

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
                <Label htmlFor="stake">Stake (CKB)</Label>
                <Input
                  id="stake"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={!canBet}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={!canBet || submitting}
                  onClick={() => void onBet()}
                >
                  {canBet
                    ? "Bet"
                    : phase === "betting"
                      ? "Betting closed"
                      : "Wait"}
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
                <Label htmlFor="stake">Stake (CKB)</Label>
                <Input
                  id="stake"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={!canBet}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={!canBet || submitting}
                  onClick={() => void onBet()}
                >
                  {canBet
                    ? "Bet"
                    : phase === "betting"
                      ? "Betting closed"
                      : "Wait"}
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
