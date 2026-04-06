# Cellbet CKB contracts

Rust [`ckb-std`](https://github.com/nervosnetwork/ckb-std) type scripts built for **riscv64imac-unknown-none-elf**. Integration tests live in [`tests/`](./tests/) (`ckb-testtool`).

## Build

From this directory:

```bash
npm run build:scripts   # both RISC-V binaries → build/release/
npm run build          # scripts + `cargo build --release` (workspace)
```

Requires `riscv64imac-unknown-none-elf` (`rustup target add …`) and Clang/LLVM for linking (see [`scripts/find_clang`](./scripts/find_clang)).

## Test

```bash
npm test
```

This builds both script binaries, then runs `cargo test` (mock CKB VM).

## Scripts

| Crate | Role |
|--------|------|
| [`contracts/crash-commit-reveal`](./contracts/crash-commit-reveal) | Early prototype: **BLAKE2b-256** of a **32-byte** preimage; witness must be exactly 32 bytes. Does **not** match the off-chain `server_seed_hash` format. |
| [`contracts/crash-seed-commit-sha256`](./contracts/crash-seed-commit-sha256) | **SHA-256** over UTF-8 `server_seed` (variable length ≤ 256 bytes). Cell data = 32-byte hash; spend proves knowledge of seed. Matches [`sha256HexUtf8`](../../packages/shared/src/provably-fair/crash.ts) / Crash proof API. |

Use the **SHA-256** script when anchoring commitments that must verify against the same strings as Postgres + the proof endpoint.

## Next (not in this folder yet)

Escrow locks, payout paths, devnet tx building, and indexer sync are described in [`docs/BETTING_PLATFORM_NERVOS_CKB.md`](../docs/BETTING_PLATFORM_NERVOS_CKB.md) §9.

Bootstrapped from [ckb-script-templates](https://github.com/cryptape/ckb-script-templates).
