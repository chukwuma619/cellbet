"use client";

import Link from "next/link";

import { CkbBalanceText } from "@/components/ckb-balance-text";
import { useCkbAddress } from "@/hooks/use-ckb-address";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function shortAddr(a: string) {
  return `${a.slice(0, 10)}…${a.slice(-6)}`;
}

export function AppHeader() {
  const { address, openConnector, disconnect, isConnected } = useCkbAddress();

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Cellbet
        </Link>
        <nav className="flex flex-1 items-center justify-center gap-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Games
          </Link>
         
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {!isConnected ? (
            <Button size="sm" onClick={() => openConnector()}>
              Connect wallet
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              {address ? (
                <CkbBalanceText
                  key={address}
                  address={address}
                  className="max-w-44 truncate font-mono text-xs tabular-nums text-muted-foreground"
                />
              ) : null}
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="font-mono text-xs">
                  {address ? shortAddr(address) : "Connected"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-mono text-xs break-all">
                  {address}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => address && void navigator.clipboard.writeText(address)}
                >
                  Copy address
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => disconnect()}>
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
