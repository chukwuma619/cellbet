DROP TABLE IF EXISTS "crash_deposit_receipts";--> statement-breakpoint
DROP TABLE IF EXISTS "wallet_accounts";--> statement-breakpoint
ALTER TABLE "crash_bets" DROP CONSTRAINT IF EXISTS "crash_bets_funding_source_check";--> statement-breakpoint
ALTER TABLE "crash_bets" DROP COLUMN IF EXISTS "funding_source";
