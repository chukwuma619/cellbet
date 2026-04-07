import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  crashBets,
  crashRounds,
  type NeonDrizzle,
  walletAccounts,
} from "@cellbet/shared/db";
import type { CrashBetStatus, CrashPhase } from "@cellbet/shared/types";

import { DRIZZLE } from "../database/database.tokens";
import { CrashGateway } from "./crash.gateway";
import {
  combineClientSeedsOrdered,
  computeCrashMultiplier,
  computeRunningDurationMs,
  multiplierAtElapsed,
  randomServerSeed,
  sha256Hex,
  verifyCrashRound,
} from "./crash.utils";

const DEFAULT_BETTING_SECONDS = 10;
const DEFAULT_TICK_MS = 50;
const DEFAULT_LOCK_MS = 800;
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 100_000;
const SETTLE_PAUSE_MS = 2500;

export type CrashParticipantPublic = {
  betId: string;
  roundId: string;
  ckbAddress: string;
  amount: string;
  /** Display label for the staked asset (e.g. CKB, future UDT symbols). */
  tokenSymbol: string;
  status: string;
  cashedOutAtMultiplier?: number;
  /** Total payout on cash-out (stake × multiplier). */
  winAmount?: number;
};

interface RuntimeRound {
  dbRoundId: string;
  roundKey: string;
  phase: CrashPhase;
  serverSeed: string;
  serverSeedHash: string;
  combinedClientSeed: string;
  crashMultiplier: number;
  runningDurationMs: number;
  bettingEndsAt: number;
  runningStartedAt: number | null;
  currentMultiplier: number;
}

@Injectable()
export class CrashService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrashService.name);
  private runtime: RuntimeRound | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private phaseTimers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DRIZZLE) private readonly db: NeonDrizzle,
    @Inject(forwardRef(() => CrashGateway))
    private readonly gateway: CrashGateway,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    void this.startNewRound().catch((err) =>
      this.logger.error("Failed to start first crash round", err),
    );
  }

  onModuleDestroy() {
    this.clearTick();
    for (const t of this.phaseTimers) clearTimeout(t);
    this.phaseTimers = [];
  }

  getPublicSnapshot() {
    const r = this.runtime;
    if (!r) return { round: null as null, participants: [] as CrashParticipantPublic[] };
    return {
      round: {
        id: r.dbRoundId,
        roundKey: r.roundKey,
        phase: r.phase,
        serverSeedHash: r.serverSeedHash,
        bettingEndsAt: r.bettingEndsAt,
        currentMultiplier: r.currentMultiplier,
        crashMultiplier:
          r.phase === "crashed" || r.phase === "settled"
            ? r.crashMultiplier
            : undefined,
        serverSeed: r.phase === "settled" ? r.serverSeed : undefined,
        combinedClientSeed:
          r.phase === "settled" ? r.combinedClientSeed : undefined,
      },
      participants: [] as CrashParticipantPublic[],
    };
  }

  /** Full snapshot including everyone who bet in the current round (for UI + reconnects). */
  async getPublicSnapshotAsync(): Promise<{
    round: {
      id: string;
      roundKey: string;
      phase: string;
      serverSeedHash: string;
      bettingEndsAt: number;
      currentMultiplier: number;
      crashMultiplier?: number;
      serverSeed?: string;
      combinedClientSeed?: string;
    } | null;
    participants: CrashParticipantPublic[];
  }> {
    const base = this.getPublicSnapshot();
    const r = this.runtime;
    if (!r || !base.round) {
      return { round: base.round, participants: [] };
    }

    const rows = await this.db
      .select({
        id: crashBets.id,
        ckbAddress: crashBets.ckbAddress,
        amount: crashBets.amount,
        status: crashBets.status,
        cashedOutAtMultiplier: crashBets.cashedOutAtMultiplier,
      })
      .from(crashBets)
      .where(eq(crashBets.roundId, r.dbRoundId))
      .orderBy(asc(crashBets.createdAt));

    const participants: CrashParticipantPublic[] = rows.map((row) => {
      const amountStr =
        row.amount != null ? String(row.amount) : "0";
      const mult =
        row.cashedOutAtMultiplier != null
          ? Number(row.cashedOutAtMultiplier)
          : undefined;
      const cashedOut =
        row.status === "cashed_out" &&
        mult !== undefined &&
        Number.isFinite(mult);
      const stake = Number(amountStr);
      return {
        betId: row.id,
        roundId: r.dbRoundId,
        ckbAddress: row.ckbAddress,
        amount: amountStr,
        tokenSymbol: "CKB",
        status: row.status,
        cashedOutAtMultiplier: cashedOut ? mult : undefined,
        winAmount:
          cashedOut && Number.isFinite(stake)
            ? stake * mult!
            : undefined,
      };
    });

    return { round: base.round, participants };
  }

  private async pushPublicState() {
    try {
      const snap = await this.getPublicSnapshotAsync();
      this.gateway.emitState(snap);
    } catch (err) {
      this.logger.error("pushPublicState failed", err);
    }
  }

  async getRoundProof(roundId: string) {
    const [row] = await this.db
      .select()
      .from(crashRounds)
      .where(eq(crashRounds.id, roundId))
      .limit(1);
    if (!row) throw new NotFoundException("Round not found");
    if (!row.serverSeed) {
      throw new BadRequestException(
        "Round not revealed yet (still in progress or missing server seed)",
      );
    }
    const crashMult =
      row.crashMultiplier != null ? Number(row.crashMultiplier) : NaN;
    if (!Number.isFinite(crashMult)) {
      throw new BadRequestException("Round outcome not finalized");
    }
    const combined = row.combinedClientSeed ?? "";
    const verification = verifyCrashRound({
      serverSeed: row.serverSeed,
      roundKey: row.roundKey,
      serverSeedHash: row.serverSeedHash,
      crashMultiplier: crashMult,
      clientSeed: combined,
    });
    return {
      roundId: row.id,
      roundKey: row.roundKey,
      serverSeedHash: row.serverSeedHash,
      serverSeed: row.serverSeed,
      combinedClientSeed: combined,
      crashMultiplier: crashMult,
      verification,
    };
  }

  async getRecentSettledRounds(limit: number) {
    const cap = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = await this.db
      .select({
        id: crashRounds.id,
        roundKey: crashRounds.roundKey,
        crashMultiplier: crashRounds.crashMultiplier,
        settledAt: crashRounds.settledAt,
      })
      .from(crashRounds)
      .where(eq(crashRounds.phase, "settled"))
      .orderBy(desc(crashRounds.settledAt))
      .limit(cap);

    return {
      rounds: rows.map((row) => ({
        id: row.id,
        roundKey: row.roundKey,
        crashMultiplier:
          row.crashMultiplier != null ? Number(row.crashMultiplier) : null,
        settledAt: row.settledAt?.toISOString() ?? null,
      })),
    };
  }

  async getRecentBetsForWallet(walletAddress: string, limit: number) {
    const cap = Math.min(200, Math.max(1, Math.floor(limit)));
    const rows = await this.db
      .select({
        betId: crashBets.id,
        roundId: crashBets.roundId,
        amount: crashBets.amount,
        status: crashBets.status,
        cashedOutAtMultiplier: crashBets.cashedOutAtMultiplier,
        profit: crashBets.profit,
        createdAt: crashBets.createdAt,
        roundKey: crashRounds.roundKey,
        roundPhase: crashRounds.phase,
        crashMultiplier: crashRounds.crashMultiplier,
      })
      .from(crashBets)
      .innerJoin(crashRounds, eq(crashBets.roundId, crashRounds.id))
      .where(eq(crashBets.ckbAddress, walletAddress))
      .orderBy(desc(crashBets.createdAt))
      .limit(cap);

    return {
      bets: rows.map((row) => ({
        betId: row.betId,
        roundId: row.roundId,
        roundKey: row.roundKey,
        roundPhase: row.roundPhase,
        amount: row.amount != null ? String(row.amount) : "0",
        status: row.status,
        cashedOutAtMultiplier:
          row.cashedOutAtMultiplier != null
            ? String(row.cashedOutAtMultiplier)
            : null,
        profit: row.profit != null ? String(row.profit) : null,
        crashMultiplier:
          row.crashMultiplier != null ? Number(row.crashMultiplier) : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async placeBet(walletAddress: string, amount: number, clientSeed?: string) {
    const r = this.runtime;
    if (!r || r.phase !== "betting" || Date.now() >= r.bettingEndsAt) {
      throw new Error("Betting is closed for this round");
    }
    const minBet = this.config.get<number>("CRASH_MIN_BET", DEFAULT_MIN_BET);
    const maxBet = this.config.get<number>("CRASH_MAX_BET", DEFAULT_MAX_BET);
    if (amount < minBet || amount > maxBet) {
      throw new Error(`Amount must be between ${minBet} and ${maxBet}`);
    }
    const trimmed = (clientSeed?.trim() ?? "").slice(0, 256);
    const seed = trimmed.length > 0 ? trimmed : null;

    await this.db
      .insert(walletAccounts)
      .values({
        ckbAddress: walletAddress,
        username: walletAddress,
      })
      .onConflictDoNothing();

    const [bet] = await this.db
      .insert(crashBets)
      .values({
        roundId: r.dbRoundId,
        ckbAddress: walletAddress,
        clientSeed: seed && seed.length > 0 ? seed : null,
        amount: String(amount),
        status: "pending",
      })
      .returning();

    this.gateway.emitBetPlaced({
      betId: bet.id,
      roundId: r.dbRoundId,
      ckbAddress: walletAddress,
      amount: String(amount),
      tokenSymbol: "CKB",
    });

    return {
      betId: bet.id,
      roundId: r.dbRoundId,
      amount: String(amount),
    };
  }

  async cashOut(walletAddress: string) {
    const r = this.runtime;
    if (!r || r.phase !== "running" || !r.runningStartedAt) {
      throw new Error("Cannot cash out right now");
    }
    const mult = r.currentMultiplier;
    const [bet] = await this.db
      .select()
      .from(crashBets)
      .where(
        and(
          eq(crashBets.roundId, r.dbRoundId),
          eq(crashBets.ckbAddress, walletAddress),
          eq(crashBets.status, "pending"),
        ),
      )
      .limit(1);
    if (!bet) throw new Error("No open bet for this round");

    const stake = Number(bet.amount);
    const profit = stake * (mult - 1);
    await this.db
      .update(crashBets)
      .set({
        status: "cashed_out" satisfies CrashBetStatus,
        cashedOutAtMultiplier: String(mult),
        profit: String(profit),
      })
      .where(eq(crashBets.id, bet.id));

    this.gateway.emitCashOut({
      betId: bet.id,
      roundId: r.dbRoundId,
      ckbAddress: walletAddress,
      amount: String(bet.amount),
      tokenSymbol: "CKB",
      cashedOutAtMultiplier: mult,
      profit,
      winAmount: stake * mult,
    });

    return { betId: bet.id, cashedOutAtMultiplier: mult, profit };
  }

  private clearTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private schedulePhase(fn: () => void, delayMs: number) {
    const t = setTimeout(() => {
      this.phaseTimers = this.phaseTimers.filter((x) => x !== t);
      fn();
    }, delayMs);
    this.phaseTimers.push(t);
  }

  async startNewRound() {
    const serverSeed = randomServerSeed();
    const roundKey = `r-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    const serverSeedHash = sha256Hex(serverSeed);
    const bettingSeconds = this.config.get<number>(
      "CRASH_BETTING_SECONDS",
      DEFAULT_BETTING_SECONDS,
    );
    const bettingEndsAt = Date.now() + bettingSeconds * 1000;

    const [row] = await this.db
      .insert(crashRounds)
      .values({
        roundKey,
        phase: "betting",
        serverSeedHash,
        bettingEndsAt: new Date(bettingEndsAt),
      })
      .returning();

    this.runtime = {
      dbRoundId: row.id,
      roundKey,
      phase: "betting",
      serverSeed,
      serverSeedHash,
      combinedClientSeed: "",
      crashMultiplier: 0,
      runningDurationMs: 0,
      bettingEndsAt,
      runningStartedAt: null,
      currentMultiplier: 1,
    };

    this.gateway.emitPhase({
      phase: "betting",
      roundId: row.id,
      roundKey,
      serverSeedHash,
      bettingEndsAt,
    });

    void this.pushPublicState();

    const untilBettingEnds = Math.max(0, bettingEndsAt - Date.now());
    this.schedulePhase(() => {
      void this.goLockedAsync();
    }, untilBettingEnds);
  }

  private async goLockedAsync() {
    const r = this.runtime;
    if (!r || r.phase !== "betting") return;
    r.phase = "locked";
    await this.db
      .update(crashRounds)
      .set({ phase: "locked", lockedAt: new Date() })
      .where(eq(crashRounds.id, r.dbRoundId));

    const betRows = await this.db
      .select({ clientSeed: crashBets.clientSeed })
      .from(crashBets)
      .where(eq(crashBets.roundId, r.dbRoundId))
      .orderBy(asc(crashBets.createdAt));

    const parts = betRows.map((b) => b.clientSeed ?? "");
    const combined = combineClientSeedsOrdered(parts);
    r.combinedClientSeed = combined;
    r.crashMultiplier = computeCrashMultiplier(r.serverSeed, r.roundKey, combined);
    r.runningDurationMs = computeRunningDurationMs(
      r.serverSeed,
      r.roundKey,
      combined,
    );

    await this.db
      .update(crashRounds)
      .set({ combinedClientSeed: combined })
      .where(eq(crashRounds.id, r.dbRoundId));

    this.gateway.emitPhase({
      phase: "locked",
      roundId: r.dbRoundId,
      roundKey: r.roundKey,
    });
    const lockMs = this.config.get<number>("CRASH_LOCK_MS", DEFAULT_LOCK_MS);
    this.schedulePhase(() => this.goRunning(), lockMs);
  }

  private goRunning() {
    const r = this.runtime;
    if (!r || r.phase !== "locked") return;
    const now = Date.now();
    r.phase = "running";
    r.runningStartedAt = now;
    r.currentMultiplier = 1;
    void this.db
      .update(crashRounds)
      .set({ phase: "running", runningAt: new Date(now) })
      .where(eq(crashRounds.id, r.dbRoundId));

    this.gateway.emitPhase({
      phase: "running",
      roundId: r.dbRoundId,
      roundKey: r.roundKey,
      startedAt: now,
    });

    const tickMs = this.config.get<number>("CRASH_TICK_MS", DEFAULT_TICK_MS);
    this.clearTick();
    this.tickTimer = setInterval(() => {
      this.tick();
    }, tickMs);
  }

  private tick() {
    const r = this.runtime;
    if (!r || r.phase !== "running" || !r.runningStartedAt) return;
    const elapsed = Date.now() - r.runningStartedAt;
    const mult = multiplierAtElapsed(
      r.crashMultiplier,
      elapsed,
      r.runningDurationMs,
    );
    r.currentMultiplier = mult;

    this.gateway.emitTick({
      roundId: r.dbRoundId,
      multiplier: mult,
      elapsedMs: elapsed,
    });

    if (elapsed >= r.runningDurationMs) {
      this.goCrashed();
    }
  }

  private goCrashed() {
    const r = this.runtime;
    if (!r || r.phase !== "running") return;
    this.clearTick();
    r.phase = "crashed";
    r.currentMultiplier = r.crashMultiplier;
    void this.db
      .update(crashRounds)
      .set({
        phase: "crashed",
        crashMultiplier: String(r.crashMultiplier),
        crashedAt: new Date(),
      })
      .where(eq(crashRounds.id, r.dbRoundId));

    void this.markLostAndSettle();
  }

  private async markLostAndSettle() {
    const r = this.runtime;
    if (!r) return;

    const pending = await this.db
      .select()
      .from(crashBets)
      .where(
        and(
          eq(crashBets.roundId, r.dbRoundId),
          eq(crashBets.status, "pending"),
        ),
      );
    for (const bet of pending) {
      const stake = Number(bet.amount);
      await this.db
        .update(crashBets)
        .set({
          status: "lost",
          profit: String(-stake),
        })
        .where(eq(crashBets.id, bet.id));
    }

    this.gateway.emitCrashed({
      roundId: r.dbRoundId,
      roundKey: r.roundKey,
      crashMultiplier: r.crashMultiplier,
    });

    r.phase = "settled";
    await this.db
      .update(crashRounds)
      .set({
        phase: "settled",
        serverSeed: r.serverSeed,
        settledAt: new Date(),
      })
      .where(eq(crashRounds.id, r.dbRoundId));

    this.gateway.emitSettled({
      roundId: r.dbRoundId,
      roundKey: r.roundKey,
      crashMultiplier: r.crashMultiplier,
      serverSeed: r.serverSeed,
      combinedClientSeed: r.combinedClientSeed,
    });

    this.schedulePhase(() => {
      void this.startNewRound().catch((err) =>
        this.logger.error("Failed to start next crash round", err),
      );
    }, SETTLE_PAUSE_MS);
  }
}
