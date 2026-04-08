-- One bet per escrow outpoint per round (aligns with docs/crash-product-flows-edge-cases.md §3.1 / §3.16).
CREATE UNIQUE INDEX IF NOT EXISTS crash_bets_round_escrow_outpoint_unique
ON crash_bets (round_id, escrow_tx_hash, escrow_output_index)
WHERE escrow_tx_hash IS NOT NULL;
