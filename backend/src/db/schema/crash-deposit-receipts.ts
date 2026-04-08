import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const crashDepositReceipts = pgTable('crash_deposit_receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  txHash: text('tx_hash').notNull(),
  outputIndex: integer('output_index').notNull().default(0),
  ckbAddress: text('ckb_address').notNull(),
  amountCkb: numeric('amount_ckb', { precision: 20, scale: 8 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
