"use client";

import { verifyCrashRound, type CrashVerifyResult } from "@cellbet/shared";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fetchCrashRoundProof } from "@/lib/api";

import type { CrashRoundPublic } from "@/hooks/use-crash-socket";

type Props = {
  round: CrashRoundPublic | null;
};

export function VerifyFairnessDialog({ round }: Props) {
  const [open, setOpen] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState(false);

  const local = useMemo(() => {
    if (
      !round?.serverSeed ||
      round.crashMultiplier === undefined ||
      !round.roundKey
    ) {
      return null;
    }
    return verifyCrashRound({
      serverSeed: round.serverSeed,
      roundKey: round.roundKey,
      serverSeedHash: round.serverSeedHash,
      crashMultiplier: round.crashMultiplier,
      clientSeed: round.combinedClientSeed ?? "",
    });
  }, [round]);

  async function crossCheckApi() {
    if (!round?.id || !local) return;
    setApiError(null);
    setApiOk(false);
    try {
      const data = (await fetchCrashRoundProof(round.id)) as {
        verification?: CrashVerifyResult;
      };
      const v = data.verification;
      if (!v) {
        setApiError("Server response missing verification.");
        return;
      }
      if (
        v.commitmentValid === local.commitmentValid &&
        v.multiplierMatches === local.multiplierMatches
      ) {
        setApiOk(true);
      } else {
        setApiError("Server verification does not match local computation.");
      }
    } catch {
      setApiError("Could not fetch server proof.");
    }
  }

  const canVerify = local !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setApiOk(false);
          setApiError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canVerify}
          className="w-full sm:w-auto"
        >
          Verify fairness
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provably fair</DialogTitle>
          <DialogDescription>
            We publish <code className="text-xs">SHA-256(server seed)</code>{" "}
            during betting. After betting closes, client seeds from bets are
            combined and mixed into the outcome (§4.9). After settle we reveal the
            server seed so you can verify the crash multiplier.
          </DialogDescription>
        </DialogHeader>
        {local && round && (
          <div className="space-y-3 text-xs">
            <div>
              <p className="text-muted-foreground mb-1 font-medium">Checks</p>
              <ul className="list-inside list-disc space-y-1">
                <li
                  className={
                    local.commitmentValid ? "text-emerald-600" : "text-destructive"
                  }
                >
                  Commitment: hash(server seed) matches published hash —{" "}
                  {local.commitmentValid ? "pass" : "fail"}
                </li>
                <li
                  className={
                    local.multiplierMatches ? "text-emerald-600" : "text-destructive"
                  }
                >
                  Outcome: computed crash multiplier matches round —{" "}
                  {local.multiplierMatches ? "pass" : "fail"}
                </li>
              </ul>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 font-medium">Computed</p>
              <p className="font-mono tabular-nums">
                Crash ×{local.crashMultiplierComputed.toFixed(2)} · Run duration{" "}
                {local.runningDurationMsComputed} ms
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground font-medium">Round key</p>
              <p className="font-mono break-all">{round.roundKey}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground font-medium">
                Published hash (SHA-256 of server seed)
              </p>
              <p className="font-mono break-all">{round.serverSeedHash}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground font-medium">Server seed (revealed)</p>
              <p className="font-mono break-all">{round.serverSeed}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground font-medium">
                Combined client seed (§4.9)
              </p>
              <p className="font-mono break-all">
                {round.combinedClientSeed === undefined ||
                round.combinedClientSeed === ""
                  ? "— (none)"
                  : round.combinedClientSeed}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => void crossCheckApi()}
            >
              Cross-check with server
            </Button>
            {apiOk && (
              <p className="text-emerald-600">Server API agrees with local verification.</p>
            )}
            {apiError && <p className="text-destructive">{apiError}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
