/** Default platform fee on crash cash-outs: 3% of gross payout (`stake × multiplier`). */
export const DEFAULT_CRASH_CASHOUT_FEE_BPS = 300;

export type CrashCashoutAmounts = {
  /** `stake × multiplier` before fee */
  grossPayout: number;
  /** Platform take: `grossPayout × feeBps / 10_000` */
  platformFee: number;
  /** Amount credited to the player: `grossPayout - platformFee` */
  netPayout: number;
  /** `netPayout - stake` */
  netProfit: number;
};

/**
 * Applies the cash-out fee to the gross return. Basis points: 300 = 3%.
 * Fee is taken from the full cashout amount (stake × multiplier), not from stake alone.
 */
export function crashCashoutAmounts(
  stake: number,
  multiplier: number,
  feeBps: number = DEFAULT_CRASH_CASHOUT_FEE_BPS,
): CrashCashoutAmounts {
  const bps = Math.min(10_000, Math.max(0, Math.floor(feeBps)));
  const grossPayout = stake * multiplier;
  const platformFee = (grossPayout * bps) / 10_000;
  const netPayout = grossPayout - platformFee;
  const netProfit = netPayout - stake;
  return { grossPayout, platformFee, netPayout, netProfit };
}
