import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Cached wallet identity for leaderboards, preferences, and off-chain UX. */
export const walletAccounts = pgTable('wallet_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ckbAddress: text('ckb_address').notNull().unique(),
  username: text('username').notNull().unique(),
  /** Spendable CKB (off-chain). Bets debit immediately; wins credit on cash-out. */
  ckbBalance: numeric('ckb_balance', { precision: 20, scale: 8 })
    .notNull()
    .default('0'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
