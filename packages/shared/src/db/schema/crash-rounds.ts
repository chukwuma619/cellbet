import {
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Server-driven Crash round: betting window → lock → run → crash → settle. */
export const crashRounds = pgTable("crash_rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundKey: text("round_key").notNull().unique(),
  phase: text("phase").notNull(),
  serverSeedHash: text("server_seed_hash").notNull(),
  serverSeed: text("server_seed"),
  /** Crash point multiplier (e.g. 2.47). Set when phase becomes crashed/settled. */
  crashMultiplier: numeric("crash_multiplier", {
    precision: 20,
    scale: 8,
  }),
  bettingEndsAt: timestamp("betting_ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  runningAt: timestamp("running_at", { withTimezone: true }),
  crashedAt: timestamp("crashed_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});
