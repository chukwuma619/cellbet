import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Off-chain round engine state (commit hashes, status, metadata). Chain remains source of truth for settlement. */
export const offchainRounds = pgTable('offchain_rounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  roundKey: text('round_key').notNull().unique(),
  gameType: text('game_type').notNull(),
  status: text('status').notNull(),
  serverSeedHash: text('server_seed_hash'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
});
