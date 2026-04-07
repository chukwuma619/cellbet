ALTER TABLE "crash_bets" ADD COLUMN IF NOT EXISTS "client_seed" text;
ALTER TABLE "crash_rounds" ADD COLUMN IF NOT EXISTS "combined_client_seed" text NOT NULL DEFAULT '';
