# Cellbet

A **Web3 betting platform** on the [Nervos CKB](https://www.nervos.org/) ecosystem. The **MVP targets a Crash-style game** (multiplier rises until it crashes; players cash out in time). Additional game modes can follow.

For architecture, fairness, and delivery phases, see [`docs/BETTING_PLATFORM_NERVOS_CKB.md`](docs/BETTING_PLATFORM_NERVOS_CKB.md).

## Monorepo layout

| Path | Role |
|------|------|
| [`frontend/`](frontend/) | Next.js app (UI, wallet integration planned via [CCC](https://docs.nervos.org/docs/sdk-and-devtool/ccc)) |
| [`backend/`](backend/) | NestJS API and services |
| [`contract/`](contract/) | CKB **lock/type scripts** (Rust) |
| [`packages/shared/`](packages/shared/) | Shared TypeScript types and utilities |

## Prerequisites

- **Node.js** (LTS recommended)
- **pnpm** `9.x` — the repo pins the package manager in `package.json` (`packageManager` field)
- **Rust** toolchain — for building and testing `contract/`

## Setup

```bash
pnpm install
```

## Scripts (from repo root)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Runs `dev` for shared, frontend, and backend in parallel |
| `pnpm dev:frontend` | Next.js dev server only |
| `pnpm dev:backend` | NestJS in watch mode |
| `pnpm build` | Builds shared, frontend, backend, and contract |
| `pnpm lint` | Lint across workspaces |
| `pnpm test` | Tests for backend and contract |

Workspace-specific scripts (e.g. `pnpm --filter @cellbet/frontend build`) work as usual with pnpm.

## Contract (CKB scripts)

The Rust workspace lives under `contract/`. From that directory, or via `pnpm --filter @cellbet/contract <script>`:

- `build` — `cargo build --release`
- `test` — `cargo test`
- `check` / `lint` / `fmt` — as defined in `contract/package.json`

## Documentation

- [Betting platform roadmap (CKB)](docs/BETTING_PLATFORM_NERVOS_CKB.md) — product scope, tooling, fairness, and phased checklist

## License

Private / unpublished (`UNLICENSED`) unless you add a public license later.
