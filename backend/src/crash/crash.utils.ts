import { randomBytes } from 'crypto';

export {
  combineClientSeedsOrdered,
  computeCrashMultiplier,
  computeRunningDurationMs,
  multiplierAtElapsed,
  sha256HexUtf8 as sha256Hex,
  verifyCrashRound,
} from '@cellbet/shared';

/** 32-byte random seed as lowercase hex (64 chars). */
export function randomServerSeed(): string {
  return randomBytes(32).toString('hex');
}
