import {
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
  /** Stake amount (same unit as API; decimal string in DB). */
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  status: text("status").notNull(),
  cashedOutAtMultiplier: numeric("cashed_out_at_multiplier", {
    precision: 20,
    scale: 8,
  }),
  /** Payout minus stake; negative or zero on loss. */
  profit: numeric("profit", { precision: 20, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
