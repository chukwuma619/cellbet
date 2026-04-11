import { fixedPointFrom, fixedPointToString } from '@ckb-ccc/core';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { CKB_MIN_OCCUPIED_CAPACITY_SHANNONS } from '@cellbet/shared';
import {
  crashBets,
  crashGameSessions,
  crashRounds,
  type NeonDrizzle,
} from '../db';
import {
  crashCashoutAmounts,
  DEFAULT_CRASH_CASHOUT_FEE_BPS,
} from './cashout-fee';
import type { CrashPhase } from './types';

import { CrashOnchainService } from '../ckb/crash-onchain.service';
import { CkbRpcService } from '../ckb/ckb-rpc.service';
import { DRIZZLE } from '../database/database.tokens';
import { CrashGateway } from './crash.gateway';
import {
  combineClientSeedsOrdered,
  computeCrashMultiplier,
  computeRunningDurationMs,
  multiplierAtElapsed,
  randomServerSeed,
  sha256Hex,
  verifyCrashRound,
} from './crash.utils';

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
  /** Net payout after platform fee (what the player receives). */
  winAmount?: number;
  /** Gross payout before fee (`stake × multiplier`). */
  grossWinAmount?: number;
  /** Platform fee in CKB (same units as `amount`). */
  platformFee?: number;
};

interface RuntimeRound {
  dbRoundId: string;
  /** On-chain `crash-round` script round id (u64). */
  chainRoundId: bigint;
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

/** Matches Drizzle `select` in `getRecentBetsForWallet` (numeric columns are strings). */
interface RecentBetForWalletRow {
  betId: string;
  roundId: string;
  amount: string;
  status: string;
  cashedOutAtMultiplier: string | null;
  profit: string | null;
  createdAt: Date;
  roundKey: string;
  roundPhase: string;
  crashMultiplier: string | null;
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
    private readonly ckbRpc: CkbRpcService,
    private readonly onchain: CrashOnchainService,
  ) {}

  onModuleInit() {
    void this.startNewRound().catch((err) =>
      this.logger.error('Failed to start first crash round', err),
    );
  }

  onModuleDestroy() {
    this.clearTick();
    for (const t of this.phaseTimers) clearTimeout(t);
    this.phaseTimers = [];
  }

  /**
   * Basis points taken from gross cash-out (stake × multiplier); default 300 = 3%.
   * Keep in sync with on-chain `crash-round` escrow cell `fee_bps` when building settlement txs.
   */
  private cashoutFeeBps(): number {
    const raw = this.config.get<string | number | undefined>(
      'CRASH_CASHOUT_FEE_BPS',
    );
    const parsed =
      raw === undefined || raw === null || raw === ''
        ? DEFAULT_CRASH_CASHOUT_FEE_BPS
        : Number(raw);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_CRASH_CASHOUT_FEE_BPS;
    }
    return Math.min(10_000, Math.max(0, Math.floor(parsed)));
  }

  getPublicSnapshot() {
    const r = this.runtime;
    if (!r)
      return {
        round: null,
        participants: [] as CrashParticipantPublic[],
      };
    return {
      round: {
        id: r.dbRoundId,
        roundKey: r.roundKey,
        chainRoundId: r.chainRoundId.toString(),
        phase: r.phase,
        serverSeedHash: r.serverSeedHash,
        bettingEndsAt: r.bettingEndsAt,
        currentMultiplier: r.currentMultiplier,
        commitAnchored: false,
        crashMultiplier:
          r.phase === 'crashed' || r.phase === 'settled'
            ? r.crashMultiplier
            : undefined,
        serverSeed: r.phase === 'settled' ? r.serverSeed : undefined,
        combinedClientSeed:
          r.phase === 'settled' ? r.combinedClientSeed : undefined,
      },
      participants: [] as CrashParticipantPublic[],
    };
  }

  /** Full snapshot including everyone who bet in the current round (for UI + reconnects). */
  async getPublicSnapshotAsync(): Promise<{
    round: {
      id: string;
      roundKey: string;
      chainRoundId: string;
      phase: string;
      serverSeedHash: string;
      bettingEndsAt: number;
      currentMultiplier: number;
      commitAnchored: boolean;
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

    const [roundMeta] = await this.db
      .select({ commitTxHash: crashRounds.commitTxHash })
      .from(crashRounds)
      .where(eq(crashRounds.id, r.dbRoundId))
      .limit(1);
    const commitAnchored = Boolean(roundMeta?.commitTxHash?.trim());
    const round = { ...base.round, commitAnchored };

    const feeBps = this.cashoutFeeBps();

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
      const amountStr = row.amount != null ? String(row.amount) : '0';
      const mult =
        row.cashedOutAtMultiplier != null
          ? Number(row.cashedOutAtMultiplier)
          : undefined;
      const cashedOut =
        row.status === 'cashed_out' &&
        mult !== undefined &&
        Number.isFinite(mult);
      const stake = Number(amountStr);
      if (!cashedOut || !Number.isFinite(stake)) {
        return {
          betId: row.id,
          roundId: r.dbRoundId,
          ckbAddress: row.ckbAddress,
          amount: amountStr,
          tokenSymbol: 'CKB',
          status: row.status,
        };
      }
      const a = crashCashoutAmounts(stake, mult, feeBps);
      return {
        betId: row.id,
        roundId: r.dbRoundId,
        ckbAddress: row.ckbAddress,
        amount: amountStr,
        tokenSymbol: 'CKB',
        status: row.status,
        cashedOutAtMultiplier: mult,
        winAmount: a.netPayout,
        grossWinAmount: a.grossPayout,
        platformFee: a.platformFee,
      };
    });

    return { round, participants };
  }

  private async pushPublicState() {
    try {
      const snap = await this.getPublicSnapshotAsync();
      this.gateway.emitState(snap);
    } catch (err) {
      this.logger.error('pushPublicState failed', err);
    }
  }

  async getRoundProof(roundId: string) {
    const [row] = await this.db
      .select()
      .from(crashRounds)
      .where(eq(crashRounds.id, roundId))
      .limit(1);
    if (!row) throw new NotFoundException('Round not found');
    if (!row.serverSeed) {
      throw new BadRequestException(
        'Round not revealed yet (still in progress or missing server seed)',
      );
    }
    const crashMult =
      row.crashMultiplier != null ? Number(row.crashMultiplier) : NaN;
    if (!Number.isFinite(crashMult)) {
      throw new BadRequestException('Round outcome not finalized');
    }
    const combined = row.combinedClientSeed ?? '';
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
      .where(eq(crashRounds.phase, 'settled'))
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
    const rows = (await this.db
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
      .limit(cap)) as RecentBetForWalletRow[];

    return {
      bets: rows.map((row) => ({
        betId: row.betId,
        roundId: row.roundId,
        roundKey: row.roundKey,
        roundPhase: row.roundPhase,
        amount: row.amount === '' ? '0' : row.amount,
        status: row.status,
        cashedOutAtMultiplier: row.cashedOutAtMultiplier,
        profit: row.profit,
        crashMultiplier:
          row.crashMultiplier != null ? Number(row.crashMultiplier) : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** Pattern A only: registered game-wallet cell → crash escrow via server co-sign. */
  async placeBet(
    walletAddress: string,
    amount: number,
    clientSeed?: string,
  ) {
    const r = this.runtime;
    if (!r || r.phase !== 'betting' || Date.now() >= r.bettingEndsAt) {
      throw new Error('Betting is closed for this round');
    }

    const minCellCkb = Number(
      fixedPointToString(CKB_MIN_OCCUPIED_CAPACITY_SHANNONS, 8),
    );
    const cfgMinBet = this.config.get<number>('CRASH_MIN_BET', DEFAULT_MIN_BET);
    const minBet = Math.max(cfgMinBet, minCellCkb);
    const maxBet = this.config.get<number>('CRASH_MAX_BET', DEFAULT_MAX_BET);
    if (amount < minBet || amount > maxBet) {
      throw new Error(`Amount must be between ${minBet} and ${maxBet}`);
    }

    const trimmed = (clientSeed?.trim() ?? '').slice(0, 256);
    const seed = trimmed.length > 0 ? trimmed : null;
    const amountStr = String(amount);
    const newShannons = fixedPointFrom(amountStr, 8);
    const feeBps = this.cashoutFeeBps();

    const [roundGate] = await this.db
      .select({ commitTxHash: crashRounds.commitTxHash })
      .from(crashRounds)
      .where(eq(crashRounds.id, r.dbRoundId))
      .limit(1);
    if (!roundGate?.commitTxHash?.trim()) {
      throw new Error(
        'This round is not anchored on-chain yet (commit cell missing). Wait a few seconds and try again.',
      );
    }

    if (!this.config.get<string>('GAME_SESSION_BACKEND_PRIVATE_KEY')?.trim()) {
      throw new Error(
        'Pattern A is not configured (set GAME_SESSION_BACKEND_PRIVATE_KEY on the server).',
      );
    }
    const [sess] = await this.db
      .select({
        sessionTxHash: crashGameSessions.sessionTxHash,
        sessionOutputIndex: crashGameSessions.sessionOutputIndex,
      })
      .from(crashGameSessions)
      .where(eq(crashGameSessions.ckbAddress, walletAddress))
      .limit(1);
    if (!sess?.sessionTxHash?.trim()) {
      throw new Error(
        'No registered game wallet. Fund a session cell and register it (POST /crash/session/register).',
      );
    }

    const submitted = await this.onchain.submitSessionFundedBet({
      sessionTxHash: sess.sessionTxHash.trim(),
      sessionOutputIndex: sess.sessionOutputIndex,
      userCkbAddress: walletAddress,
      chainRoundId: r.chainRoundId,
      serverSeedHashHex: r.serverSeedHash,
      stakeShannons: newShannons,
      feeBps,
    });

    const hNorm = submitted.txHash.startsWith('0x')
      ? submitted.txHash
      : (`0x${submitted.txHash}` as `0x${string}`);
    const outIdx = submitted.escrowOutputIndex;

    const [dupBet] = await this.db
      .select({ id: crashBets.id })
      .from(crashBets)
      .where(
        and(
          eq(crashBets.roundId, r.dbRoundId),
          eq(crashBets.escrowTxHash, hNorm),
          eq(crashBets.escrowOutputIndex, outIdx),
        ),
      )
      .limit(1);
    if (dupBet) {
      throw new Error(
        'This escrow output is already registered for a bet in this round.',
      );
    }

    await this.onchain.verifyUserEscrowCell({
      escrowTxHash: hNorm,
      escrowOutputIndex: outIdx,
      userCkbAddress: walletAddress,
      chainRoundId: r.chainRoundId,
      serverSeedHashHex: r.serverSeedHash,
      stakeShannons: newShannons,
      feeBps,
    });

    const newSessTx = submitted.newSessionTxHash.startsWith('0x')
      ? submitted.newSessionTxHash
      : (`0x${submitted.newSessionTxHash}` as `0x${string}`);

    await this.db
      .update(crashGameSessions)
      .set({
        sessionTxHash: newSessTx,
        sessionOutputIndex: submitted.newSessionOutputIndex,
        updatedAt: new Date(),
      })
      .where(eq(crashGameSessions.ckbAddress, walletAddress));

    const [bet] = await this.db
      .insert(crashBets)
      .values({
        roundId: r.dbRoundId,
        ckbAddress: walletAddress,
        clientSeed: seed,
        amount: amountStr,
        status: 'pending',
        escrowTxHash: hNorm,
        escrowOutputIndex: outIdx,
      })
      .returning();

    if (!bet) {
      throw new Error('Could not place bet');
    }

    const betId = String(bet.id);
    this.gateway.emitBetPlaced({
      betId,
      roundId: r.dbRoundId,
      ckbAddress: walletAddress,
      amount: amountStr,
      tokenSymbol: 'CKB',
    });
    void this.pushPublicState();
    return {
      betId,
      roundId: r.dbRoundId,
      amount: amountStr,
      funding: 'session' as const,
    };
  }

  async cashOut(walletAddress: string, requestedBetId?: string) {
    const r = this.runtime;
    if (!r || r.phase !== 'running' || !r.runningStartedAt) {
      throw new Error('Cannot cash out right now');
    }
    const mult = r.currentMultiplier;
    const multStr = String(mult);
    const feeBps = this.cashoutFeeBps();

    const trimmedBetId = requestedBetId?.trim();
    const [candidate] = trimmedBetId
      ? await this.db
          .select({
            id: crashBets.id,
            amount: crashBets.amount,
            escrowTxHash: crashBets.escrowTxHash,
            escrowOutputIndex: crashBets.escrowOutputIndex,
          })
          .from(crashBets)
          .where(
            and(
              eq(crashBets.id, trimmedBetId),
              eq(crashBets.roundId, r.dbRoundId),
              eq(crashBets.ckbAddress, walletAddress),
              eq(crashBets.status, 'pending'),
            ),
          )
          .limit(1)
      : await this.db
          .select({
            id: crashBets.id,
            amount: crashBets.amount,
            escrowTxHash: crashBets.escrowTxHash,
            escrowOutputIndex: crashBets.escrowOutputIndex,
          })
          .from(crashBets)
          .where(
            and(
              eq(crashBets.roundId, r.dbRoundId),
              eq(crashBets.ckbAddress, walletAddress),
              eq(crashBets.status, 'pending'),
            ),
          )
          .orderBy(asc(crashBets.createdAt))
          .limit(1);

    if (!candidate) {
      throw new Error(
        trimmedBetId
          ? 'No open bet matches that id for this round'
          : 'No open bet for this round',
      );
    }

    const stake = Number(candidate.amount);
    const amounts =
      Number.isFinite(stake) && Number.isFinite(mult)
        ? crashCashoutAmounts(stake, mult, feeBps)
        : null;

    if (!candidate.escrowTxHash?.trim()) {
      throw new Error(
        'This bet has no on-chain escrow — Pattern A bets must mint escrow; contact support.',
      );
    }

    const txH = candidate.escrowTxHash.startsWith('0x')
      ? candidate.escrowTxHash
      : `0x${candidate.escrowTxHash}`;
    const settlementTxHash = await this.onchain.settleWinOnChain({
      escrow: {
        txHash: txH as `0x${string}`,
        outputIndex: candidate.escrowOutputIndex ?? 0,
      },
      userCkbAddress: walletAddress,
      multiplier: mult,
    });

    const profit =
      Number.isFinite(stake) && Number.isFinite(mult)
        ? stake * ((mult * (10000 - feeBps)) / 10000 - 1)
        : 0;

    const [updatedBet] = await this.db
      .update(crashBets)
      .set({
        status: 'cashed_out',
        cashedOutAtMultiplier: multStr,
        profit: String(profit),
        settlementTxHash,
      })
      .where(
        and(eq(crashBets.id, candidate.id), eq(crashBets.status, 'pending')),
      )
      .returning();

    if (!updatedBet) {
      throw new Error(
        'Bet state changed after on-chain settlement — contact support if funds look wrong.',
      );
    }

    const betId = String(updatedBet.id);
    const amountStr =
      updatedBet.amount != null ? String(updatedBet.amount) : '0';

    this.gateway.emitCashOut({
      betId,
      roundId: r.dbRoundId,
      ckbAddress: walletAddress,
      amount: amountStr,
      tokenSymbol: 'CKB',
      cashedOutAtMultiplier: mult,
      profit: amounts?.netProfit ?? 0,
      winAmount: amounts?.netPayout ?? 0,
      grossWinAmount: amounts?.grossPayout,
      platformFee: amounts?.platformFee,
      cashoutFeeBps: feeBps,
    });

    return {
      betId,
      cashedOutAtMultiplier: mult,
      profit: amounts?.netProfit ?? 0,
      grossWinAmount: amounts?.grossPayout,
      platformFee: amounts?.platformFee,
      netPayout: amounts?.netPayout,
      settlementTxHash,
    };
  }

  private async anchorCommitForRound(
    dbRoundId: string,
    chainRoundId: bigint,
    serverSeedUtf8: string,
  ) {
    try {
      const ref = await this.onchain.anchorCommitForRound({
        chainRoundId,
        serverSeedUtf8,
      });
      await this.db
        .update(crashRounds)
        .set({
          commitTxHash: ref.txHash,
          commitOutputIndex: ref.outputIndex,
        })
        .where(eq(crashRounds.id, dbRoundId));
      void this.pushPublicState();
    } catch (e) {
      this.logger.error(
        `Anchor commit cell failed for round ${dbRoundId}`,
        e instanceof Error ? e.stack : e,
      );
    }
  }

  private async maybeRevealCommitForRound(
    dbRoundId: string,
    serverSeedUtf8: string,
  ) {
    const [round] = await this.db
      .select({
        commitTxHash: crashRounds.commitTxHash,
        commitOutputIndex: crashRounds.commitOutputIndex,
        commitRevealTxHash: crashRounds.commitRevealTxHash,
      })
      .from(crashRounds)
      .where(eq(crashRounds.id, dbRoundId))
      .limit(1);
    if (!round?.commitTxHash || round.commitRevealTxHash) return;
    try {
      const txH = round.commitTxHash.startsWith('0x')
        ? round.commitTxHash
        : `0x${round.commitTxHash}`;
      const revealTx = await this.onchain.revealCommitForRound({
        commit: {
          txHash: txH as `0x${string}`,
          outputIndex: round.commitOutputIndex ?? 0,
        },
        serverSeedUtf8,
      });
      await this.db
        .update(crashRounds)
        .set({ commitRevealTxHash: revealTx })
        .where(eq(crashRounds.id, dbRoundId));
    } catch (e) {
      this.logger.error(
        `Commit reveal failed for round ${dbRoundId}`,
        e instanceof Error ? e.stack : e,
      );
    }
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
    const roundKey = `r-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const serverSeedHash = sha256Hex(serverSeed);
    const bettingSeconds = this.config.get<number>(
      'CRASH_BETTING_SECONDS',
      DEFAULT_BETTING_SECONDS,
    );
    const bettingEndsAt = Date.now() + bettingSeconds * 1000;

    const [row] = await this.db
      .insert(crashRounds)
      .values({
        roundKey,
        phase: 'betting',
        serverSeedHash,
        bettingEndsAt: new Date(bettingEndsAt),
      })
      .returning();

    if (row.chainRoundId == null) {
      throw new Error(
        'crash_rounds.chain_round_id is missing — apply migration 0008_crash_onchain.sql',
      );
    }

    this.runtime = {
      dbRoundId: row.id,
      chainRoundId: row.chainRoundId,
      roundKey,
      phase: 'betting',
      serverSeed,
      serverSeedHash,
      combinedClientSeed: '',
      crashMultiplier: 0,
      runningDurationMs: 0,
      bettingEndsAt,
      runningStartedAt: null,
      currentMultiplier: 1,
    };

    this.gateway.emitPhase({
      phase: 'betting',
      roundId: row.id,
      roundKey,
      chainRoundId: row.chainRoundId.toString(),
      serverSeedHash,
      bettingEndsAt,
    });

    void this.anchorCommitForRound(row.id, row.chainRoundId, serverSeed);

    void this.pushPublicState();

    const untilBettingEnds = Math.max(0, bettingEndsAt - Date.now());
    this.schedulePhase(() => {
      void this.goLockedAsync();
    }, untilBettingEnds);
  }

  private async goLockedAsync() {
    const r = this.runtime;
    if (!r || r.phase !== 'betting') return;
    r.phase = 'locked';
    await this.db
      .update(crashRounds)
      .set({ phase: 'locked', lockedAt: new Date() })
      .where(eq(crashRounds.id, r.dbRoundId));

    const betRows = await this.db
      .select({ clientSeed: crashBets.clientSeed })
      .from(crashBets)
      .where(eq(crashBets.roundId, r.dbRoundId))
      .orderBy(asc(crashBets.createdAt));

    const parts = betRows.map((b) => b.clientSeed ?? '');
    const combined = combineClientSeedsOrdered(parts);
    r.combinedClientSeed = combined;
    r.crashMultiplier = computeCrashMultiplier(
      r.serverSeed,
      r.roundKey,
      combined,
    );
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
      phase: 'locked',
      roundId: r.dbRoundId,
      roundKey: r.roundKey,
      chainRoundId: r.chainRoundId.toString(),
    });
    const lockMs = this.config.get<number>('CRASH_LOCK_MS', DEFAULT_LOCK_MS);
    this.schedulePhase(() => this.goRunning(), lockMs);
  }

  private goRunning() {
    const r = this.runtime;
    if (!r || r.phase !== 'locked') return;
    const now = Date.now();
    r.phase = 'running';
    r.runningStartedAt = now;
    r.currentMultiplier = 1;
    void this.db
      .update(crashRounds)
      .set({ phase: 'running', runningAt: new Date(now) })
      .where(eq(crashRounds.id, r.dbRoundId));

    this.gateway.emitPhase({
      phase: 'running',
      roundId: r.dbRoundId,
      roundKey: r.roundKey,
      chainRoundId: r.chainRoundId.toString(),
      startedAt: now,
    });

    const tickMs = this.config.get<number>('CRASH_TICK_MS', DEFAULT_TICK_MS);
    this.clearTick();
    this.tickTimer = setInterval(() => {
      this.tick();
    }, tickMs);
  }

  private tick() {
    const r = this.runtime;
    if (!r || r.phase !== 'running' || !r.runningStartedAt) return;
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
    if (!r || r.phase !== 'running') return;
    this.clearTick();
    r.phase = 'crashed';
    r.currentMultiplier = r.crashMultiplier;
    void this.db
      .update(crashRounds)
      .set({
        phase: 'crashed',
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
          eq(crashBets.status, 'pending'),
        ),
      );
    for (const bet of pending) {
      const stake = Number(bet.amount);
      let forfeitTx: string | undefined;
      if (bet.escrowTxHash?.trim()) {
        const txH = bet.escrowTxHash.startsWith('0x')
          ? bet.escrowTxHash
          : `0x${bet.escrowTxHash}`;
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            forfeitTx = await this.onchain.settleForfeitOnChain({
              escrow: {
                txHash: txH as `0x${string}`,
                outputIndex: bet.escrowOutputIndex ?? 0,
              },
            });
            break;
          } catch (e) {
            this.logger.error(
              `On-chain forfeit failed for bet ${bet.id} (attempt ${attempt}/${maxAttempts}): ${String(e)}`,
            );
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 500 * attempt));
            }
          }
        }
      } else {
        this.logger.warn(
          `Pending bet ${bet.id} has no escrow_tx_hash; marking lost without on-chain forfeit`,
        );
      }
      await this.db
        .update(crashBets)
        .set({
          status: 'lost',
          profit: String(-stake),
          settlementTxHash: forfeitTx ?? null,
        })
        .where(eq(crashBets.id, bet.id));
    }

    this.gateway.emitCrashed({
      roundId: r.dbRoundId,
      roundKey: r.roundKey,
      crashMultiplier: r.crashMultiplier,
    });

    r.phase = 'settled';
    await this.db
      .update(crashRounds)
      .set({
        phase: 'settled',
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

    void this.maybeRevealCommitForRound(r.dbRoundId, r.serverSeed);

    this.schedulePhase(() => {
      void this.startNewRound().catch((err) =>
        this.logger.error('Failed to start next crash round', err),
      );
    }, SETTLE_PAUSE_MS);
  }

  async registerGameSession(
    walletAddress: string,
    txHash: string,
    outputIndex: number,
  ): Promise<{ ok: true }> {
    await this.onchain.validateSessionRegistration({
      sessionTxHash: txHash,
      sessionOutputIndex: outputIndex,
      userCkbAddress: walletAddress,
    });
    const trimmed = txHash.trim();
    const hNorm = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
    await this.db
      .insert(crashGameSessions)
      .values({
        ckbAddress: walletAddress,
        sessionTxHash: hNorm,
        sessionOutputIndex: outputIndex,
      })
      .onConflictDoUpdate({
        target: crashGameSessions.ckbAddress,
        set: {
          sessionTxHash: hNorm,
          sessionOutputIndex: outputIndex,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  }

  getPatternASessionConfig() {
    return this.onchain.getPatternASessionPublicConfig();
  }

  async getGameSession(walletAddress: string): Promise<
    | { active: false }
    | {
        active: true;
        sessionTxHash: string;
        sessionOutputIndex: number;
        updatedAt: string;
        capacityCkb: string;
        capacityShannons: string;
      }
  > {
    const [row] = await this.db
      .select({
        sessionTxHash: crashGameSessions.sessionTxHash,
        sessionOutputIndex: crashGameSessions.sessionOutputIndex,
        updatedAt: crashGameSessions.updatedAt,
      })
      .from(crashGameSessions)
      .where(eq(crashGameSessions.ckbAddress, walletAddress))
      .limit(1);
    if (!row?.sessionTxHash?.trim()) {
      return { active: false };
    }
    const cap = await this.onchain.getLiveSessionCellCapacityShannons({
      sessionTxHash: row.sessionTxHash.trim(),
      sessionOutputIndex: row.sessionOutputIndex,
    });
    if (cap === null) {
      await this.db
        .delete(crashGameSessions)
        .where(eq(crashGameSessions.ckbAddress, walletAddress));
      return { active: false };
    }
    return {
      active: true,
      sessionTxHash: row.sessionTxHash,
      sessionOutputIndex: row.sessionOutputIndex,
      updatedAt: row.updatedAt.toISOString(),
      capacityCkb: fixedPointToString(cap, 8),
      capacityShannons: cap.toString(),
    };
  }

  async closeGameSession(walletAddress: string): Promise<{ ok: true }> {
    await this.db
      .delete(crashGameSessions)
      .where(eq(crashGameSessions.ckbAddress, walletAddress.trim()));
    return { ok: true };
  }
}
