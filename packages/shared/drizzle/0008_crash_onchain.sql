CREATE SEQUENCE IF NOT EXISTS crash_chain_round_id_seq;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN IF NOT EXISTS "chain_round_id" bigint;--> statement-breakpoint
UPDATE "crash_rounds" SET "chain_round_id" = nextval('crash_chain_round_id_seq') WHERE "chain_round_id" IS NULL;--> statement-breakpoint
ALTER TABLE "crash_rounds" ALTER COLUMN "chain_round_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD CONSTRAINT "crash_rounds_chain_round_id_unique" UNIQUE ("chain_round_id");--> statement-breakpoint
ALTER TABLE "crash_rounds" ALTER COLUMN "chain_round_id" SET DEFAULT nextval('crash_chain_round_id_seq'::regclass);--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN IF NOT EXISTS "commit_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN IF NOT EXISTS "commit_output_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN IF NOT EXISTS "commit_reveal_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crash_bets" ADD COLUMN IF NOT EXISTS "escrow_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crash_bets" ADD COLUMN IF NOT EXISTS "escrow_output_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_bets" ADD COLUMN IF NOT EXISTS "settlement_tx_hash" text;
