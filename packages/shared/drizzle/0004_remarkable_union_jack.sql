ALTER TABLE "crash_bets" ADD COLUMN "client_seed" text;--> statement-breakpoint
ALTER TABLE "crash_rounds" ADD COLUMN "combined_client_seed" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_bets" DROP COLUMN "auto_cashout_multiplier";