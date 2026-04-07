# Cellbet CKB contracts

Rust [`ckb-std`](https://github.com/nervosnetwork/ckb-std) type scripts built for **riscv64imac-unknown-none-elf**. Integration tests live in [`tests/`](./tests/) (`ckb-testtool`).

## Build

From this directory:

```bash
npm run build:scripts   # RISC-V binary → build/release/
npm run build          # scripts + `cargo build --release` (workspace)
```

Requires `riscv64imac-unknown-none-elf` (`rustup target add …`) and Clang/LLVM for linking (see [`scripts/find_clang`](./scripts/find_clang)).

## Test

```bash
npm test
```

This builds the script binary, then runs `cargo test` (mock CKB VM).

## Script

| Crate | Role |
|--------|------|
| [`contracts/crash-round`](./contracts/crash-round) | **Unified** crash type script: **commit** cell (42 B) for `round_id` + SHA-256(UTF-8 seed); **escrow** cell (148 B) with user / house / **platform** lock hashes, stake, and **fee_bps** (e.g. 300 = 3%). **Loss:** 2-byte forfeit witness → full capacity to house, **no** fee. **Win:** 28-byte witness → 3 outputs; **platform** receives `floor((user+platform) * fee_bps / 10000)` from gross cash-out, **user** gets the remainder of that gross, **house** gets the rest of the cell capacity. |

TypeScript encoders live in `@cellbet/shared` (`encodeCrashEscrowCellDataV2`, `encodeCrashWinWitnessV2`, `encodeCrashForfeitWitnessV1`, etc.).

Bootstrapped from [ckb-script-templates](https://github.com/cryptape/ckb-script-templates).
