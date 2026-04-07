import { sql } from 'drizzle-orm';
import {
  bigint,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const crashRounds = pgTable('crash_rounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  roundKey: text('round_key').notNull().unique(),
  chainRoundId: bigint('chain_round_id', { mode: 'bigint' })
    .notNull()
    .unique()
    .default(sql`nextval('crash_chain_round_id_seq'::regclass)`),
  phase: text('phase').notNull(),
  serverSeedHash: text('server_seed_hash').notNull(),
  serverSeed: text('server_seed'),
  combinedClientSeed: text('combined_client_seed').notNull().default(''),
  crashMultiplier: numeric('crash_multiplier', {
    precision: 20,
    scale: 8,
  }),
  bettingEndsAt: timestamp('betting_ends_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  runningAt: timestamp('running_at', { withTimezone: true }),
  crashedAt: timestamp('crashed_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  /** House-anchored commit cell tx (server seed hash commitment). */
  commitTxHash: text('commit_tx_hash'),
  commitOutputIndex: integer('commit_output_index').notNull().default(0),
  commitRevealTxHash: text('commit_reveal_tx_hash'),
});
