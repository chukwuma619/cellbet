/**
 * Shared domain types used by frontend, backend, and other packages.
 */

export type ID = string;

export const CRASH_PHASES = [
  "betting",
  "locked",
  "running",
  "crashed",
  "settled",
] as const;

export type CrashPhase = (typeof CRASH_PHASES)[number];

export const CRASH_BET_STATUSES = [
  "pending",
  "cashed_out",
  "lost",
] as const;

export type CrashBetStatus = (typeof CRASH_BET_STATUSES)[number];
