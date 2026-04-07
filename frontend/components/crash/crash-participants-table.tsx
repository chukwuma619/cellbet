"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CrashParticipant } from "@/hooks/use-crash-socket";
import { cn } from "@/lib/utils";

function addressHue(address: string): number {
  let h = 0;
  for (let i = 0; i < address.length; i++) {
    h = (h * 31 + address.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function PlayerAvatar({ address }: { address: string }) {
  const hue = addressHue(address);
  const hue2 = (hue + 40) % 360;
  return (
    <div
      className="size-8 shrink-0 rounded-full ring-1 ring-border/60"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${hue2} 50% 32%))`,
      }}
      aria-hidden
    />
  );
}

export function truncateCkbAddress(address: string, head = 6, tail = 4): string {
  const t = address.trim();
  if (t.length <= head + tail + 1) return t;
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

function formatStake(amount: string, tokenSymbol: string): string {
  const n = Number(amount);
  const formatted = Number.isFinite(n)
    ? n >= 100
      ? n.toFixed(2)
      : n.toFixed(4).replace(/\.?0+$/, "")
    : amount;
  return `${formatted} ${tokenSymbol}`;
}

function formatWin(amount: number | undefined, tokenSymbol: string): string {
  if (amount === undefined || !Number.isFinite(amount)) return "";
  const formatted =
    amount >= 100 ? amount.toFixed(2) : amount.toFixed(4).replace(/\.?0+$/, "");
  return `${formatted} ${tokenSymbol}`;
}

type Props = {
  participants: CrashParticipant[];
  className?: string;
};

export function CrashParticipantsTable({ participants, className }: Props) {
  return (
    <div className={cn("space-y-2", className)}>
     
      <Table
        className="border-0 text-sm [&_td]:border-0 [&_th]:border-0"
        data-slot="crash-participants-table"
      >
        <TableHeader className="[&_tr]:border-0">
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className="h-9 px-2 text-xs font-medium text-muted-foreground">
              Player
            </TableHead>
            <TableHead className="h-9 px-2 text-xs font-medium text-muted-foreground">
              Bet
            </TableHead>
            <TableHead className="h-9 px-2 text-right text-xs font-medium text-muted-foreground">
              X
            </TableHead>
            <TableHead className="h-9 px-2 text-right text-xs font-medium text-muted-foreground">
              Win
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr]:border-0">
          {participants.length === 0 ? (
            <TableRow className="border-0 hover:bg-transparent">
              <TableCell
                colSpan={4}
                className="text-muted-foreground py-6 text-center text-xs"
              >
                No bets yet this round.
              </TableCell>
            </TableRow>
          ) : (
            participants.map((p) => {
              const showCashout =
                p.cashedOutAtMultiplier !== undefined &&
                p.winAmount !== undefined;
              return (
                <TableRow key={p.betId} className="border-0 hover:bg-muted/40">
                  <TableCell className="px-2 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <PlayerAvatar address={p.ckbAddress} />
                      <span className="font-mono text-xs truncate">
                        {truncateCkbAddress(p.ckbAddress)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-2 font-mono tabular-nums">
                    {formatStake(p.amount, p.tokenSymbol)}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                    {showCashout ? `${p.cashedOutAtMultiplier!.toFixed(2)}×` : ""}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                    {showCashout
                      ? formatWin(p.winAmount, p.tokenSymbol)
                      : ""}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
