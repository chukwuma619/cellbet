CREATE TABLE "crash_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"ckb_address" text NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"auto_cashout_multiplier" numeric(20, 8),
	"status" text NOT NULL,
	"cashed_out_at_multiplier" numeric(20, 8),
	"profit" numeric(20, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crash_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_key" text NOT NULL,
	"phase" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"server_seed" text,
	"crash_multiplier" numeric(20, 8),
	"betting_ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"running_at" timestamp with time zone,
	"crashed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "crash_rounds_round_key_unique" UNIQUE("round_key")
);
--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD COLUMN "username" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_bets" ADD CONSTRAINT "crash_bets_round_id_crash_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."crash_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_username_unique" UNIQUE("username");