# Crash: internal balance & deposit pool (plan)

This document captures the recommended approach for **instant bet placement** in crash: users **pre-fund a pool** (occasional on-chain deposit + wallet confirmation), then **each bet** only debits an internal balance in Postgres—no wallet in the hot path—so betting rounds are not missed while waiting for signatures.

## Problem

Today each bet builds and broadcasts a CKB escrow transaction (`buildPlaceBetTx` → `signer.sendTransaction`) before `placeBet` runs. Wallet confirmation can outlast the **betting** window.

## Goal

Separate **slow money movement** from **fast round entry**:

| Step | Where funds live | Wallet |
|------|------------------|--------|
| Deposit | User → pool address / vault (on-chain) | Yes (occasional) |
| Bet | Debit `wallet_accounts.ckb_balance`, insert `crash_bets` | No |
| Cash out (win) | Credit `ckb_balance` and/or payout tx (see below) | Optional |
| Withdraw | `ckb_balance` → user CKB address | Yes (occasional) |

Optional: keep **per-round escrow** bets as an “advanced / trust-minimized” path; **default UX** = balance-backed bets.

## Existing codebase notes

- `wallet_accounts.ckb_balance` already exists with intent: spendable off-chain balance; bets debit; wins credit on cash-out.
- There is a DB trigger (`cellbet_credit_wallet_on_crash_cashout`) on `crash_bets` updates that credits `ckb_balance` on cash-out—**reconcile this with** `crashCashoutAmounts` / fee bps so you do not double-credit or mismatch fees.
- `getCkbBalance` currently returns **on-chain** balance from RPC, not `ckb_balance`—the API should expose **pool balance** for betting UX.
- `markLostAndSettle` already handles bets **without** `escrow_tx_hash` (marks lost, no on-chain forfeit). Stake for balance bets should be debited **at bet time**, so no extra deduction on lose.
- `cashOut` today requires escrow and calls `settleWinOnChain`—balance-backed bets need a **separate branch**.

---

## Phase 1 — Core ledger (MVP)

### 1.1 Single source of truth for playable balance

- Treat `wallet_accounts.ckb_balance` as **spendable pool balance**.
- Expose **pool balance** in the API separately from **on-chain free balance**; the crash UI should prioritize pool balance for instant bets.

### 1.2 Deposits (on-chain → credit)

- Define the **deposit surface**: one deposit address (house-controlled) or a small dedicated deposit script if you need per-user attribution.
- **Credit path** (choose one):
  - **Indexer / webhook**: observe transfers, idempotent credit per outpoint.
  - **Submitted tx hash**: client sends `depositTxHash`; backend verifies via RPC (similar to escrow verification), then credits once.
- **Rules**: idempotency per outpoint, minimum deposit, optional confirmation depth before credit.

### 1.3 Instant bet (`placeBet`)

- Add a **mode** (e.g. `funding: 'balance' | 'escrow'`) or make `escrowTxHash` optional when funding is balance.
- In **`placeBet`**, use a **single DB transaction**:
  - `SELECT … FOR UPDATE` on `wallet_accounts` for that address.
  - Check `ckb_balance >= stake` (keep existing min/max bet rules).
  - `UPDATE wallet_accounts SET ckb_balance = ckb_balance - stake`.
  - `INSERT crash_bets` with `escrow_tx_hash` = NULL.
- Do **not** call `verifyUserEscrowCell` for balance bets.
- Keep existing gates (e.g. commit anchored) if they are required for fairness.

### 1.4 Cash out (win) for balance-backed bets

- Branch when there is **no** escrow:
  - **Option A (fastest MVP):** no on-chain tx on cash-out—compute net win with the same fee math as today, update `crash_bets` to `cashed_out`, credit `ckb_balance` in application code **or** align the existing trigger—**avoid double credit**.
  - **Option B:** credit `ckb_balance` and enqueue a treasury payout tx later (more moving parts).

Recommend **Option A for MVP**, then add **withdraw** so users can move CKB to self-custody.

### 1.5 Lose / crash

- No extra on-chain forfeit for balance bets (already supported when `escrow_tx_hash` is empty). Stake must already have been debited at bet placement.

### 1.6 Withdrawals

- Endpoint: amount bounded by `ckb_balance`; server sends from treasury/hot wallet to user address; deduct `ckb_balance` after successful broadcast (or use a pending-withdraw state).

---

## Phase 2 — Product & safety

- **Concurrency:** row locks on `wallet_accounts` for bet + withdraw.
- **Reconciliation job:** compare treasury vs sum of obligations (`ckb_balance` + open exposure).
- **Limits:** daily deposit/withdraw caps as needed.
- **UX:** “Add funds” before playing; show pool balance on crash; **one-tap bet** without wallet popup.

---

## Phase 3 — Optional hardening

- Append-only **ledger_entries** (deposit, bet_lock, win, lose, withdraw).
- Optional retention of **escrow-backed** bets for users who will not pre-deposit.
- Stronger on-chain settlement for large wins or batch payouts.

---

## Implementation touchpoints (order)

1. DTOs — `place-bet.dto.ts`: optional escrow when using balance.
2. `crash.service.ts` — `placeBet` branch + transactional debit; `cashOut` branch when `!escrowTxHash` with fee-correct credit.
3. **Trigger vs app credit** — unify with `crashCashoutAmounts`; no double credit.
4. Frontend — `crash-game-client.tsx`: `postBet` without `buildPlaceBetTx` when using balance; display pool balance from API.
5. New services — deposit verification; withdraw flow.

---

## Success criteria

- Bet placement does **not** call `signer.sendTransaction`.
- Time to join a round is dominated by network + API + DB, not wallet confirmation.
- Deposits and withdrawals remain the only flows that routinely need wallet time.

---

## Open decisions

- **Deposit verification:** submitted tx hash (simpler) vs indexer (more robust at scale).
- **Cash-out:** internal credit only (MVP) vs treasury payout on every win.
