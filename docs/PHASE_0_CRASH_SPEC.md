# Phase 0 — Crash discovery (Cellbet)

**Status:** Active specification. Implementation must match this document; when code diverges, update this file first or in the same change.

**Scope:** Crash MVP only. Other games reuse patterns only after this is stable.

---

## 1. Product decisions

### 1.1 Custody model (current vs target)

| Period | Model |
|--------|--------|
| **Now** | **Off-chain demo**: stakes are numeric records in Postgres; no CKB moves. Wallet address identifies the user for UX only. |
| **Target** | **TBD before Phase 1**: choose **non-custodial on-chain escrow** (bets locked in cells) vs **hybrid** (off-chain round engine + on-chain settlement). This spec does not mandate the choice yet; §6 lists constraints for when CKB lands. |

### 1.2 Round model

- **Discrete rounds**, not a continuous unbounded curve across sessions.
- **Phases (server-authoritative):** `betting` → `locked` → `running` → `crashed` → `settled`, then a new round starts.
- **Betting window:** Configurable (`CRASH_BETTING_SECONDS`, default **10s**). Bets accepted only while `phase === betting` and wall time `< bettingEndsAt`.
- **Lock buffer:** Short `locked` phase (`CRASH_LOCK_MS`, default **800ms**); no new bets.
- **Running phase:** Multiplier displayed increases **linearly** from **1.00×** toward the predetermined crash multiplier over a **deterministic duration** (`computeRunningDurationMs`, range **5s–20s** from seed + round key).
- **Tick rate:** Configurable (`CRASH_TICK_MS`, default **50ms**) for server ticks and WebSocket updates.
- **Between rounds:** Configurable pause (`SETTLE_PAUSE_MS`, default **2500ms**) before the next round starts.

### 1.3 Crash point (outcome)

- For each round, the **crash multiplier** \(M\) is fixed **before** the running phase starts from **`serverSeed`** and **`roundKey`** only (see §3).
- **Bounds:** \(M \in [1.01, 1000]\), two decimal places after floor (implementation uses floor to cents).
- **House edge:** **1%** baked into the mapping from uniform \(u\) to \(M\) (see §3.1). No separate rake on profit in the current formula.

### 1.4 Cash-out rules

- **Manual cash-out:** Allowed only while `phase === running` and the bet is `pending`. Payout basis: stake at **current server multiplier** at request time (see §4.2).
- **Auto cash-out:** Optional target multiplier \(T\) on the bet. If at any tick the **displayed** multiplier reaches \(T\) and \(T < M\) (crash point), the bet is settled as cashed out at **\(T\)**. If \(T \ge M\), the player **cannot** auto-cash before crash; they lose unless they manual-cash below \(M\) (same as manual).
- **If no cash-out before crash:** Bet status `lost`, profit = **−stake**.

### 1.5 Bet limits (demo / off-chain)

| Parameter | Default | Env override |
|-----------|---------|--------------|
| Min stake | `1` | `CRASH_MIN_BET` |
| Max stake | `100_000` | `CRASH_MAX_BET` |
| Auto cash-out target | \(1.01\)–\(1000\) | (same bounds in API) |

Units are **abstract demo units** until CKB amounts are wired.

### 1.6 Fees and rake

- **Current:** No per-bet fee in the API; house edge is only via the crash distribution (§3.1).
- **Future:** If a rake on profit or stake is introduced, it must be documented here and reflected in on-chain scripts or server rules.

### 1.7 Late transaction / ordering (on-chain preview)

**Not enforced in the current off-chain MVP.** Policy for CKB (to finalize before mainnet):

- **Place bet:** If a bet transaction confirms **after** the round has left `betting`, the bet is **rejected** or **refunded** (choose one; default recommendation: **reject** with no fund movement if tx never bound to round).
- **Cash-out:** If a cash-out confirms **after** the crash is finalized on-chain, treat as **lost** (no payout). **Ordering** is by chain confirmation, not by “when the user tapped.”
- **Server/UI desync:** UI may show a multiplier that does not match chain confirmation time; **chain + script rules win** for settlement.

---

## 2. Fairness claims (off-chain MVP)

### 2.1 What “provably fair” means here

- Before the round leaves `betting`, the operator publishes **`server_seed_hash = SHA256(server_seed)`** (hex string in API and DB).
- After `settled`, the operator publishes **`server_seed`** (same encoding as used for hashing).
- Anyone can recompute **`computeCrashMultiplier(server_seed, round_key)`** and **`computeRunningDurationMs(server_seed, round_key)`** and verify they match the round outcome **if** they trust the published `round_key` and phase timestamps match the committed hash.

### 2.2 Client seed

- **Current:** **Not used.** Outcome depends only on `server_seed` and `round_key`.
- **Future (optional):** Add `client_seed` per user or per round in the hash input so the server cannot pick a seed after seeing client input; document and implement in §3.

### 2.3 Verification UI (target)

- **“Verify round”** action: inputs = `server_seed`, `round_key`, outputs = crash multiplier \(M\) and duration; compare to DB / chain commitment.
- **On-chain commitment** of `server_seed_hash` is **out of scope** for the current MVP; recommended before public trust.

---

## 3. Cryptographic formulas (normative)

Reference implementation: `backend/src/crash/crash.utils.ts`.

### 3.1 Crash multiplier

1. `u = first 4 bytes of SHA256(server_seed || round_key) as uint32 / 2^32`, clamped to \((10^{-9}, 1-10^{-9})\).
2. `e = 1 - 0.01` (house edge).
3. `raw = e / u`, `m = floor(raw * 100) / 100`.
4. `M = min(1000, max(1.01, m))`.

### 3.2 Running duration

`duration_ms = 5000 + (uint32 from SHA256(server_seed || round_key || "duration") mod 15001)` → **[5000, 20000] ms**.

### 3.3 Display multiplier during running

For elapsed time `t` ms from run start, duration `D`:

`display(t) = 1 + (M - 1) * min(1, t / D)` (linear).

At `t >= D`, display equals `M` and the round crashes.

---

## 4. Trust boundaries (current)

| Layer | Trusted for |
|-------|-------------|
| **Server** | Phase transitions, bet acceptance timing, cash-out ordering, DB integrity. |
| **Postgres** | Audit trail for demo stakes; **not** for real-money settlement. |
| **Client** | Display only; animation may lag; **never** authoritative for payout. |
| **CKB / scripts** | **Not yet in play** for Crash. |

### 4.1 Operator capabilities (honest-but-curious framing)

- The operator **could** in theory alter `round_key` or timestamps before hash commitment if not committed on-chain; **mitigation** = on-chain hash commitment + indexer (Phase 1+).

### 4.2 Cash-out timestamp

- Server uses **its own clock** at request handling for the multiplier used in manual cash-out. **Future:** sign “multiplier at time T” or anchor to block height for on-chain.

---

## 5. Open items before Phase 1 (protocol)

- [ ] Choose **hybrid vs full on-chain** escrow (§1.1).
- [ ] Decide **client seed** inclusion (§2.2).
- [ ] Commit **`server_seed_hash` on CKB** (which cell, which type script).
- [ ] Specify **cell layout** for one bet vs many (§5 on-chain design in main roadmap).
- [ ] Pin **CCC / CKB SDK versions** in the monorepo.

---

## 6. Legal / compliance gate

- [ ] **Counsel review** before **public testnet with real users** or marketing (see main roadmap §10).
- [ ] Terms of service, privacy policy, restricted jurisdictions — **not done** in Phase 0 code.

---

## 7. Document history

| Date | Change |
|------|--------|
| 2026-04-06 | Initial Phase 0 spec from existing backend behavior. |
