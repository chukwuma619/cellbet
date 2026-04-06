import { AppShell } from "@/components/app-shell";

import { CrashGameClient } from "./crash-game-client";

export default function CrashPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Crash</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Stake during the countdown, cash out before the crash. Demo stakes
            only — no on-chain funds yet.
          </p>
        </div>
        <CrashGameClient />
      </div>
    </AppShell>
  );
}
