ALTER TABLE "wallet_accounts" ADD COLUMN "ckb_balance" numeric(20, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION cellbet_credit_wallet_on_crash_cashout()
RETURNS TRIGGER AS $$
DECLARE
  pay_rows int;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'cashed_out'
     AND OLD.status = 'pending'
     AND NEW.cashed_out_at_multiplier IS NOT NULL
  THEN
    UPDATE wallet_accounts
    SET ckb_balance = ckb_balance + (NEW.amount::numeric * NEW.cashed_out_at_multiplier::numeric)
    WHERE ckb_address = NEW.ckb_address;
    GET DIAGNOSTICS pay_rows = ROW_COUNT;
    IF pay_rows = 0 THEN
      RAISE EXCEPTION 'wallet_account missing for crash cash-out (ckb_address=%)', NEW.ckb_address;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_crash_bets_credit_wallet" ON "crash_bets";--> statement-breakpoint
CREATE TRIGGER "trg_crash_bets_credit_wallet"
  AFTER UPDATE ON "crash_bets"
  FOR EACH ROW
  EXECUTE PROCEDURE cellbet_credit_wallet_on_crash_cashout();
