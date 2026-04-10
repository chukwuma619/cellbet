import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Pattern A: live game-wallet cell outpoint (updates after each session-funded bet). */
export const crashGameSessions = pgTable('crash_game_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  ckbAddress: text('ckb_address').notNull().unique(),
  sessionTxHash: text('session_tx_hash').notNull(),
  sessionOutputIndex: integer('session_output_index').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
