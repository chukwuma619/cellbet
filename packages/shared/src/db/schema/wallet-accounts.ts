import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Cached wallet identity for leaderboards, preferences, and off-chain UX. */
export const walletAccounts = pgTable("wallet_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ckbAddress: text("ckb_address").notNull().unique(),
  username: text("username").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
