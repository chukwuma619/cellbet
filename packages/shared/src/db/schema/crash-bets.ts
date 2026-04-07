import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { crashRounds } from "./crash-rounds";

export const crashBets = pgTable("crash_bets", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => crashRounds.id, { onDelete: "cascade" }),
  ckbAddress: text("ckb_address").notNull(),
  clientSeed: text("client_seed"),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  status: text("status").notNull(),
  cashedOutAtMultiplier: numeric("cashed_out_at_multiplier", {
    precision: 20,
    scale: 8,
  }),
  /** Payout minus stake; negative or zero on loss. */
  profit: numeric("profit", { precision: 20, scale: 8 }),
  /** On-chain escrow cell out point (place-bet tx). */
  escrowTxHash: text("escrow_tx_hash"),
  escrowOutputIndex: integer("escrow_output_index").notNull().default(0),
  /** Win / forfeit settlement tx hash when settled on-chain. */
  settlementTxHash: text("settlement_tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
