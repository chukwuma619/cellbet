/**
 * Pure helpers shared across apps (no Node/browser-only APIs unless clearly split).
 */

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
