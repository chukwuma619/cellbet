CREATE TABLE IF NOT EXISTS "crash_game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ckb_address" text NOT NULL,
	"session_tx_hash" text NOT NULL,
	"session_output_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crash_game_sessions_ckb_address_unique" UNIQUE("ckb_address")
);
