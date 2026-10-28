# Leash — Agent Spending Vault

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app.

---

## What This App Does

Leash is a USDC spending account for AI agents on Arc. An owner deposits USDC and sets a policy (agent address, per-payment cap, daily cap, payee allowlist, rate limit). The agent calls `pay()` — payments inside the policy execute immediately; payments that break a soft rule are held for owner review. Hard violations (frozen vault, denylist, zero payee, zero amount) do NOT revert: they move no funds, increment `blockedCount`, and emit a `Blocked` event. The owner uses `approve()`/`deny()` to settle held requests. `autonomyRate()` returns `(paidAlone, held, blocked)`.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS — Arc Dark theme
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/Leash.sol`, unit tests in `contracts/test/*.t.sol`, corpus script in `contracts/script/Corpus.s.sol`.
- Chain: Arc Testnet (Chain ID: 5042002)
- Token: Native USDC (18 decimals for msg.value on Arc), ERC-20 USDC 6 decimals for display

## Deployed Contracts

| Contract | Network | Address | Explorer | Purpose |
|---|---|---|---|---|
| Leash v3 (demo, **current**) | Arc Testnet | `0xb9b3ca78cacdc85495997ee45919c5f4ffd81874` | [explorer](https://explorer.testnet.arc.io/address/0xb9b3ca78cacdc85495997ee45919c5f4ffd81874) | Live app — MCP agent integration |
| Leash v2 (demo, prev) | Arc Testnet | `0xefa3c47b0f754608b37de7c2fd832c60a42087cb` | [explorer](https://explorer.testnet.arc.io/address/0xefa3c47b0f754608b37de7c2fd832c60a42087cb) | Pre-check() deploy |
| Leash v2 (corpus) | Arc Testnet | `0xb1d92345e1cb250552ce04338728c66bebad86ab` | [explorer](https://explorer.testnet.arc.io/address/0xb1d92345e1cb250552ce04338728c66bebad86ab) | Previous corpus reference deploy |
| Leash v1 (deprecated) | Arc Testnet | `0xe65fd3ce2ea1a77ade5d5c3b7ef5cc9ddf24ac4f` | [explorer](https://explorer.testnet.arc.io/address/0xe65fd3ce2ea1a77ade5d5c3b7ef5cc9ddf24ac4f) | Removed IMemo |

Constructor args used for v3 demo deploy:
- `owner_`: `0x586664F50674c2f93767D249902e872eb6738ea0` (your MetaMask)
- `agent`: `0x49f600611E93e33d06a93CcC4aDbB202b0CCACbF` (local MCP server wallet)
- `perPaymentCap`: `1000000000000000000` (1 USDC native)
- `dailyCap`: `5000000000000000000` (5 USDC native)
- `maxPerHour`: `10`

## Corpus Vaults (on-chain run)

| Vault | Address | Purpose | paidAlone | heldCount | blockedCount |
|---|---|---|---|---|---|
| vaultMain | `0xb1dc5Ebf7993428da0E53764baD49bE2258402B4` | groups 1,2,4,5,6,7 | 9 | 36 | 10 |
| vaultDaily | `0x417B03c47Bd7a86f3fB562f95db7E6eC5433768F` | group 3 daily-cap | 3 | 14 | 0 |
| stale-1 | `0x5a70b756304602E3569FDB5Fa50333b55fE56C17` | early failed run — 2 USDC recovered | — | — | — |
| stale-2 | `0x820475Eed108Ffe8005A28f75DBdef56096Cb8E6` | early failed run — 1 USDC recovered | — | — | — |

All four owned by corpus wallet `0x0513FCCb398c181BB73F71Ba45E3336f5A32Ef4d`.

## Key Files

- `src/App.tsx` — Thin composition root, 3-tab layout
- `src/components/OwnerView.tsx` — Deposit, policy edit, freeze, held queue, autonomy rate
- `src/components/LiveLedger.tsx` — Real-time Paid/Held/Approved/Denied/Blocked event log; reads Memo events (filtered by target = Leash) and shows memo text next to Paid entries
- `src/components/AgentSimulator.tsx` — Preset payment buttons; routes via Arc Memo contract by default, toggle to direct pay()
- `src/leash-contract.ts` — Contract address, ABI import, amount conversion utilities
- `contracts/Leash.sol` — Main vault contract
- `contracts/test/*.t.sol` — 106 Foundry unit tests
- `contracts/script/Corpus.s.sol` — 50-scenario corpus replay script

## Corpus Results

**Forge simulation (fork):** Paid 18 / Held 22 / Blocked 10 / Total 50 / WRONG 0

**On-chain run (complete):** 50/50 cases broadcast as real txs. Totals: Paid 6 / Held 34 / Blocked 10 / WRONG 12. The 12 WRONG are all expected-Paid-got-Held from rate-limit and daily-cap contamination caused by the mid-run interruption (3 hourly slots and 3 daily fills already consumed). Contract logic is correct — WRONG 0 on a clean vault (forge simulation). Results in `corpus-results.json`.

## Arc-Specific Notes

- Arc native gas IS USDC at 18 decimals. All `msg.value` transfers are in 18-decimal native units.
- `displayToNative()` converts "0.02" USDC to 18-decimal bigint; `nativeToDisplay()` does the reverse.
- No ERC-20 transfers in the contract — only `call{value: amount}`.
- Memo contract at `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` (same on testnet and mainnet). The agent calls `Memo.memo(target=Leash, data=abi.encode(pay(…)), memoId, memoData)` rather than calling Leash directly, so the EOA remains the original msg.sender (via CallFrom). The simulator has a toggle to switch to direct `pay()` calls.
- There is NO contract at `0x0000000000000000000000000000000000000066` on Arc — the old IMemo precompile approach was wrong and has been removed.

## Incidents

### Corpus wallet ran out of gas (2026-10-27)

The first onchain corpus run attempted to deploy fresh vaults on each retry after the script crashed mid-run (address checksum bug, then rate-limit error). Each attempted deploy consumed gas without committing a vault, so the corpus wallet's 4 USDC was spent almost entirely on gas. The money was NOT lost: 3 USDC remained locked in two successfully-deployed stale vaults (0x5a70… and 0x8204…), and the wallet itself was drained to ~0.001 USDC — not enough to pay gas to call `withdrawAll`. The runner has been rewritten to be resumable (reads existing events, never deploys a new vault if one already exists, checks balance before every tx, writes `corpus-results.json` incrementally). A fresh 0.05 USDC gas injection will allow the wallet to bootstrap a `withdraw()` call on vaultMain, then call `withdrawAll` on both stale vaults to recover the 3 USDC and finish the run.

## Ownership

- `owner` is now a constructor argument (`owner_`). The platform deployer wallet was passed at deploy time. Use `transferOwnership(yourAddress)` from the platform deployer wallet to take ownership.
- `transferOwnership` emits `OwnershipTransferred`, rejects `address(0)`.

## check() Design

`check(payee, amount)` is a read-only preview function for MCP agents: call it before `pay()` to know whether a payment would be Paid (0), Held (1), or Blocked (2), and which rule would trigger.

Key invariant: `check()` and `pay()` share a single internal function `_evaluate(payee, amount)` so they can never disagree. The daily-cap check in `_evaluate` treats `dailySpent` as 0 if a new day has started (pure view — no state write), and `pay()` then calls `_rollDayIfNeeded()` as a state mutation only on the Paid path.

`remainingToday()` returns `dailyCap - effectiveDailySpent` (0 if over), using the same day-roll logic.

Rule strings returned by `check()`:
- `""` — in-policy, will Paid
- `"insufficient_balance"` — rules pass but vault can't cover it (Paid outcome, balance check still reverts in pay())
- `"per_payment_cap"`, `"daily_cap"`, `"allowlist"`, `"rate_limit"` — soft violations → Held
- `"frozen"`, `"zero_payee"`, `"denylist"`, `"zero_amount"` — hard violations → Blocked

## Hard Violation Semantics

- Frozen vault, denylist, zero payee, zero amount: do NOT revert. Move no funds, increment `blockedCount`, emit `Blocked(id, payee, amount, reason, ruleBroken)`.
- Only access-control and bookkeeping failures are errors that revert: `NotOwner`, `NotAgent`, `RequestNotFound`, `AlreadySettled`, `InsufficientBalance`.
- `autonomyRate()` returns `(paidAlone, held, blocked)` — three counters.
