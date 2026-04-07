"use client";

/**
 * Shown when fast off-chain game state may disagree with confirmed chain state
 * (e.g. multiplier still animating while an on-chain anchor or settlement already finalized).
 */
export function ChainDesyncBanner(props: {
  message: string;
  /** e.g. dismiss until next round */
  onDismiss?: () => void;
}) {
  const { message, onDismiss } = props;
  return (
    <div
      role="status"
      className="border-amber-500/50 bg-amber-500/10 text-amber-200 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          className="text-amber-100/80 hover:text-amber-50 shrink-0 underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
