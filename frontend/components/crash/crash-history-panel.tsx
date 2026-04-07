"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchCrashBetHistory,
  fetchCrashRoundHistory,
  type CrashBetHistoryItem,
  type CrashRoundHistoryItem,
} from "@/lib/api";

function shortId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatNum(s: string | null | undefined) {
  if (s == null || s === "") return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function betResultLabel(b: CrashBetHistoryItem) {
  if (b.status === "cashed_out") {
    const mult = b.cashedOutAtMultiplier;
    return mult != null ? `Out @ ${Number(mult).toFixed(2)}×` : "Cashed out";
  }
  if (b.status === "lost") {
    return b.crashMultiplier != null
      ? `Lost (crash ${b.crashMultiplier.toFixed(2)}×)`
      : "Lost";
  }
  if (b.status === "pending") return "Open";
  return b.status;
}

type Props = {
  walletAddress: string | null;
  refreshKey?: string;
};

export function CrashHistoryPanel({ walletAddress, refreshKey }: Props) {
  const [rounds, setRounds] = useState<CrashRoundHistoryItem[]>([]);
  const [bets, setBets] = useState<CrashBetHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, b] = await Promise.all([
        fetchCrashRoundHistory(25),
        walletAddress
          ? fetchCrashBetHistory(walletAddress, 40)
          : Promise.resolve({ bets: [] }),
      ]);
      setRounds(r.rounds);
      setBets(b.bets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const recentNet = bets.reduce((sum, bet) => {
    if (bet.profit == null || bet.profit === "") return sum;
    const p = Number(bet.profit);
    return sum + (Number.isFinite(p) ? p : 0);
  }, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>
            Recent settled rounds and your bets (off-chain records).
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {walletAddress && bets.length > 0 && (
          <p className="text-muted-foreground mb-4 text-sm">
            Net on listed bets (demo units):{" "}
            <span
              className={
                recentNet >= 0 ? "text-foreground font-medium" : "text-destructive font-medium"
              }
            >
              {recentNet >= 0 ? "+" : ""}
              {recentNet.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
          </p>
        )}
        {error && (
          <p className="text-destructive mb-4 text-sm" role="alert">
            {error}
          </p>
        )}
        <Tabs defaultValue="rounds">
          <TabsList className="mb-4">
            <TabsTrigger value="rounds">Recent rounds</TabsTrigger>
            <TabsTrigger value="bets" disabled={!walletAddress}>
              My bets
            </TabsTrigger>
          </TabsList>
          <TabsContent value="rounds">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Round</TableHead>
                  <TableHead>Crash</TableHead>
                  <TableHead>Settled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rounds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      No settled rounds yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rounds.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">
                        {shortId(row.id)}
                      </TableCell>
                      <TableCell>
                        {row.crashMultiplier != null
                          ? `${row.crashMultiplier.toFixed(2)}×`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatWhen(row.settledAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="bets">
            {!walletAddress ? (
              <p className="text-muted-foreground text-sm">
                Connect a wallet to see your bet history.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stake</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>P/L</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : bets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        No bets yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    bets.map((b) => {
                      const pl = b.profit != null ? Number(b.profit) : NaN;
                      const plLabel =
                        b.profit != null && Number.isFinite(pl)
                          ? `${pl >= 0 ? "+" : ""}${formatNum(b.profit)}`
                          : "—";
                      return (
                        <TableRow key={b.betId}>
                          <TableCell>{formatNum(b.amount)}</TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {betResultLabel(b)}
                          </TableCell>
                          <TableCell
                            className={
                              Number.isFinite(pl) && pl < 0
                                ? "text-destructive"
                                : Number.isFinite(pl) && pl > 0
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                            }
                          >
                            {plLabel}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatWhen(b.createdAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
