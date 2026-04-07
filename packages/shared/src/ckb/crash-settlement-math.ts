import { DEFAULT_CRASH_CASHOUT_FEE_BPS } from "../crash/cashout-fee";

export function grossCashoutShannons(
  stakeShannons: bigint,
  multiplier: number,
): bigint {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error("multiplier must be a non-negative finite number");
  }
  const m = Math.floor(multiplier * 1e8);
  return (stakeShannons * BigInt(m)) / 100_000_000n;
}

export function platformFeeFromGrossShannons(
  grossShannons: bigint,
  feeBps: number = DEFAULT_CRASH_CASHOUT_FEE_BPS,
): bigint {
  const b = BigInt(Math.min(10_000, Math.max(0, Math.floor(feeBps))));
  return (grossShannons * b) / 10000n;
}

export function userNetFromGrossShannons(
  grossShannons: bigint,
  feeBps: number = DEFAULT_CRASH_CASHOUT_FEE_BPS,
): {
  platformShannons: bigint;
  userShannons: bigint;
} {
  const platformShannons = platformFeeFromGrossShannons(grossShannons, feeBps);
  const userShannons = grossShannons - platformShannons;
  return { platformShannons, userShannons };
}
