export const CRASH_PHASES = [
  'betting',
  'locked',
  'running',
  'crashed',
  'settled',
] as const;

export type CrashPhase = (typeof CRASH_PHASES)[number];
