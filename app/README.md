# Leash — Agent Spending Vault

A USDC spending account for AI agents on Arc. An owner deposits USDC, sets a spending policy, and an agent autonomously makes payments within those rules. Payments that break a soft rule are queued for owner review; hard violations (frozen vault, denylist, zero values) are silently blocked — they leave an onchain evidence trail without reverting. The owner approves or denies queued requests through a live dashboard.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS (Arc Dark theme)
- **Web3**: wagmi v2, viem v2, ConnectKit
- **Smart contract**: Solidity 0.8.28, Foundry
- **Chain**: Arc Testnet (Chain ID 5042002) — USDC is the native gas token
- **Memo integration**: Arc predeployed Memo contract at `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`

## Deployed Contracts

| Name | Network | Address |
|---|---|---|
| Leash v3 (demo, current) | Arc Testnet | `0xb9b3ca78cacdc85495997ee45919c5f4ffd81874` |
| Leash v2 (demo, prev) | Arc Testnet | `0xefa3c47b0f754608b37de7c2fd832c60a42087cb` |
| vaultMain (corpus) | Arc Testnet | `0xb1dc5Ebf7993428da0E53764baD49bE2258402B4` |
| vaultDaily (corpus) | Arc Testnet | `0x417B03c47Bd7a86f3fB562f95db7E6eC5433768F` |

The v3 demo vault: owner = `0x5866…8ea0` (your MetaMask), agent = `0x49f6…cACbF` (MCP server wallet), perPaymentCap = 1 USDC, dailyCap = 5 USDC, maxPerHour = 10. Adds `check()` + `remainingToday()` for agent pre-flight queries.

## Development

### Prerequisites

- Node.js 18+ and [Bun](https://bun.sh)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)

### Install

```bash
bun install
```

### Environment Variables

| Variable | Purpose |
|---|---|
| (none required for read-only use) | |

All onchain facts (chain IDs, RPC URLs, USDC addresses) are imported from `src/onchain-facts.ts` — no manual configuration needed.

### Run (development)

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Lint and typecheck

```bash
bun run check
```

### Compile contracts

```bash
forge build
```

### Run contract tests

```bash
forge test
```

### Run corpus script (50 scenarios, fork simulation)

```bash
forge script contracts/script/Corpus.s.sol --rpc-url https://rpc.testnet.arc.io -vv
```

### Run corpus on-chain (real transactions, resumable)

```bash
LEASH_PRIVATE_KEY=0x... bun run scripts/run-corpus-onchain.ts
```

The script reuses fixed vault addresses, recovers already-completed cases from on-chain events, and writes `corpus-results.json` after every transaction. It stops gracefully if the wallet balance drops below 0.1 USDC.

**Corpus results (on-chain, Arc Testnet):**

| Vault | Address | paidAlone | heldCount | blockedCount |
|---|---|---|---|---|
| vaultMain | `0xb1dc5Ebf7993428da0E53764baD49bE2258402B4` | 9 | 36 | 10 |
| vaultDaily | `0x417B03c47Bd7a86f3fB562f95db7E6eC5433768F` | 3 | 14 | 0 |

Totals (50 cases): **Paid 6 / Held 34 / Blocked 10 / WRONG 12**. The 12 wrong cases are all expected-Paid-got-Held due to run-state contamination from the mid-run interruption (rate-limit slots and daily cap already consumed by the partial run). Contract logic is correct — WRONG 0 against a clean vault in the forge simulation.

## Features

- **Agent Simulator**: send preset or custom payments as the agent wallet. Routes via Arc's Memo contract by default (preserves EOA as msg.sender); toggle to direct `pay()` calls.
- **Live Ledger**: real-time log of Paid, Held, Blocked, Approved and Denied events. Reads Memo events filtered by the Leash address and surfaces memo text next to matching Paid entries.
- **Owner View**: deposit funds, update policy, freeze the vault, approve or deny held requests, view autonomy rate.
- **Autonomy rate**: `autonomyRate()` returns `(paidAlone, held, blocked)` so you can track how often the agent acts alone vs. requires review vs. gets hard-blocked.

## Payment Outcomes

| Outcome | Trigger | Funds move? | Reverts? |
|---|---|---|---|
| Paid | In-policy | Yes | No |
| Held | Soft rule broken (cap, allowlist, rate limit) | No | No |
| Blocked | Hard violation (frozen, denylist, zero payee/amount) | No | No |
| InsufficientBalance | Vault empty | No | Yes (bookkeeping error) |

## What broke and how it was fixed

The onchain corpus runner's first three attempts each crashed after deploying fresh vaults — once from a viem EIP-55 address checksum error and twice from public RPC rate limits — before the deployed vault was ever configured or used. On Arc the gas token is USDC, so each failed attempt consumed real USDC in fees. The money was not destroyed: 3 USDC ended up trapped in two "stale" vaults at `0x5a70…` and `0x8204…`, with the corpus wallet drained to less than 0.001 USDC — not enough gas to call `withdrawAll` to recover it. The fix: the runner was rewritten to be fully resumable (it reads existing on-chain events to reconstruct which cases already ran, never deploys a new vault unless none exists, bootstraps its own gas by calling `withdraw()` on the still-funded active vault, and writes `corpus-results.json` after every transaction). The two stale vaults still hold 3 USDC pending a small gas injection to recover them.
