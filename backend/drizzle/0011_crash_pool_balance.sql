ALTER TABLE "crash_bets" ADD COLUMN "funding_source" text NOT NULL DEFAULT 'escrow';--> statement-breakpoint
ALTER TABLE "crash_bets" ADD CONSTRAINT "crash_bets_funding_source_check" CHECK ("funding_source" IN ('escrow', 'balance'));--> statement-breakpoint
CREATE TABLE "crash_deposit_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_hash" text NOT NULL,
	"output_index" integer DEFAULT 0 NOT NULL,
	"ckb_address" text NOT NULL,
	"amount_ckb" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crash_deposit_receipts_tx_hash_output_unique" UNIQUE("tx_hash","output_index")
);--> statement-breakpoint
CREATE INDEX "crash_deposit_receipts_ckb_address_idx" ON "crash_deposit_receipts" ("ckb_address");
