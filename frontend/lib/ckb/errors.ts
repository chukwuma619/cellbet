import { ErrorTransactionInsufficientCapacity } from "@ckb-ccc/core";

export type CellbetCkbErrorCode =
  | "WRONG_NETWORK"
  | "INSUFFICIENT_CKB"
  | "SIGNATURE_REJECTED"
  | "ROUND_CLOSED"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export class CellbetCkbError extends Error {
  readonly code: CellbetCkbErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: CellbetCkbErrorCode, cause?: unknown) {
    super(message);
    this.name = "CellbetCkbError";
    this.code = code;
    this.cause = cause;
  }
}

export function mapCkbException(e: unknown): CellbetCkbError {
  if (e instanceof CellbetCkbError) return e;
  if (e instanceof ErrorTransactionInsufficientCapacity) {
    return new CellbetCkbError(
      "Not enough CKB to cover this output and fees.",
      "INSUFFICIENT_CKB",
      e,
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (
    lower.includes("user rejected") ||
    lower.includes("reject") ||
    lower.includes("denied")
  ) {
    return new CellbetCkbError("Wallet rejected the request.", "SIGNATURE_REJECTED", e);
  }
  return new CellbetCkbError(msg || "Unknown CKB error", "UNKNOWN", e);
}

export function userMessageForCkbError(err: CellbetCkbError): string {
  switch (err.code) {
    case "WRONG_NETWORK":
      return "Switch your wallet to the network this app expects (see environment).";
    case "INSUFFICIENT_CKB":
      return err.message;
    case "SIGNATURE_REJECTED":
      return "Signature was rejected or cancelled.";
    case "ROUND_CLOSED":
      return "This round is no longer accepting that action on-chain.";
    case "NOT_CONFIGURED":
      return "On-chain Cellbet scripts are not configured for this deployment.";
    default:
      return err.message;
  }
}
