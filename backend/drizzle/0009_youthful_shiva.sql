ALTER TABLE "crash_bets" ADD COLUMN "escrow_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crash_bets" ADD COLUMN "escrow_output_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_bets" ADD COLUMN "settlement_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN "chain_round_id" bigint DEFAULT nextval('crash_chain_round_id_seq'::regclass) NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN "commit_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN "commit_output_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN "commit_reveal_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD CONSTRAINT "crash_rounds_chain_round_id_unique" UNIQUE("chain_round_id");