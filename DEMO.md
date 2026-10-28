# Leash — recorded demo on Arc testnet

> Your AI agent pays on its own. Above the line, it asks.

Every row below is a real Arc testnet transaction made by an AI agent connected to Leash over MCP,
or by the owner's wallet. Click any link to check it on the explorer.

**Vault:** [`0x923a…eca1`](https://testnet.arcscan.app/address/0x923aa72a2ff76f91358ffc5a87b5afb202beeca1)
(deploy [`0x59fb…3436`](https://testnet.arcscan.app/tx/0x59fb9bf3eb828054386756cf06e8f2c7bb6119569cb74494cf1d588758fd3436), block 69432747)
· owner `0x5866…8ea0` (a human's MetaMask) · agent `0x49f6…ACbF` (held by the local MCP server)
· rules: **$1.00 a day** · funded with 3 USDC at deploy.

The agent below is an MCP client calling the Leash MCP server's tools (`leash_get_rules`, `leash_check_payment`,
`leash_pay`), exactly as Claude Code or Cursor would. Raw output: `mcp/demo-results.json`.

## 1. A real payment, with its record

The agent paid **$0.05** to `0x7F3E…c19a` with the reason *"Demo: paying for one weather API call"*.

Transaction [`0x3373…2403`](https://testnet.arcscan.app/tx/0x3373c4bdc72b439a51eeeae8ba6b7b173392df6f3ccacbf1f74d54ad5b382403)
(block 69432855, fee 0.0052 USDC) contains, in order:

1. `BeforeMemo` — Arc's Memo contract opens the frame.
2. **USDC `Transfer`** from Arc's system emitter — the 0.05 USDC actually moving.
3. **`Leash.Paid`** (payment #1) — the contract decided it was inside the rules.
4. **`Memo("Demo: paying for one weather API call")`** — the agent's reason, on-chain.

The payee's balance afterwards: exactly **0.05 USDC**.

## 2. The security boundary

| What the agent tried | Expected | What happened on-chain | Transaction |
|---|---|---|---|
| Ask first: would $0.05 go through? | paid | `check()` → paid (read-only, no transaction) | — |
| **$0.05**, inside the $1.00 daily limit | Paid | ✅ `Paid` + USDC transfer + Memo | [`0x3373…2403`](https://testnet.arcscan.app/tx/0x3373c4bdc72b439a51eeeae8ba6b7b173392df6f3ccacbf1f74d54ad5b382403) |
| **$2.00**, more than the whole daily limit | Held for the owner | ⏸ `Held` (payment #2, rule `per_payment_cap`) + Memo. **No USDC transfer log** — nothing moved. | [`0x56e3…58e8`](https://testnet.arcscan.app/tx/0x56e3bc4d62d436ae81d63394ab91835328dbaaf592be57a9b75852b5349858e8) |
| **Agent's own key calls `setPolicy`** to raise its limit to $1,000/day, bypassing MCP | Rejected | ❌ **Reverted with `NotOwner`**. Rules re-read afterwards: still $1.00/day, $0.95 left. | [`0x8fd9…a2f0`](https://testnet.arcscan.app/tx/0x8fd901bd3d902b885890f1843a29bd3a83c08d116b44ddd642e1c63d2124a2f0) |

| **Owner** reviews the held $2.00 in the Leash app and approves it | Released by the human | ✅ `Approved` (payment #2) — the 2 USDC moves only after the owner's signature. Vault 2.95 → 0.95 USDC. | [`0xb2bf…e16d`](https://testnet.arcscan.app/tx/0xb2bf61e9b05efe3f9ce9d3fca8a63733dabc4908ed1c1b0aa6bd09eb487de16d) |

### Payees: the owner names who the agent may pay

The owner activated **weather API** (`0x7F3E…c19a`) from the app
([`setAllowlist`](https://testnet.arcscan.app/address/0x586664F50674c2f93767D249902e872eb6738ea0), signed in MetaMask).
From then on the contract holds payments to anyone else.

| What the agent tried | Expected | What happened on-chain | Transaction |
|---|---|---|---|
| **$0.05 to "weather API"**, by name (the MCP server resolves the name; the agent never types an address) | Paid | ✅ `Paid` (payment #3) + USDC transfer + Memo *"Demo: forecast for the user’s trip"*. The agent also attached a note in its local log. | [`0x7bd0…1254`](https://testnet.arcscan.app/tx/0x7bd07b10829410c13463e78392ab3470d36fe03cf16791bed32be854b7981254) |
| **$0.05 to an address the owner never saved** | Held: not a payee | ⏸ `Held` (payment #4, rule `allowlist`) + Memo. **No USDC transfer** — that address still holds 0. | [`0x2492…f241`](https://testnet.arcscan.app/tx/0x2492b0a21436433c3c32cbb3779640001f19e486c9667fed5f6b10e2964af241) |
| Owner approves the same held payment twice (a double click) | Pay once | ❌ The second `approve` reverted with **`AlreadySettled`** — the contract never pays a request twice. | [`0x2a78…5f39`](https://testnet.arcscan.app/tx/0x2a780c434526a40d93d8902344e95ccd6e30a648b751eae0e3d46587f9245f39) |

Balances confirm it: weather API's address holds exactly 2.10 USDC (0.05 + the approved 2.00 + 0.05); the unknown address holds 0.

_Still to record (needs the owner's wallet): a per-payee limit ($0.10 for weather API) and a blocked payee._

The agent cannot move the boundary itself: its key calling `setPolicy` is rejected by the contract (`NotOwner`),
and the MCP server offers it no tool that changes rules, payees, the freeze switch or the vault balance.

## 3. Why Arc

Leash is not a dashboard on top of a generic chain. Each piece below depends on something Arc provides:

| Arc feature | How Leash uses it | Where to see it |
|---|---|---|
| **USDC is the gas token** | The agent wallet holds one asset. It pays network fees and payees in the same USDC, so its budget is exact and nobody tops it up with a separate gas coin. | The agent wallet's balance and every agent transaction's fee, in USDC |
| **Memo contract** (`0x5294…e505`) | Every agent payment goes through `Memo.memo(…)`, so the agent's reason ("paying for one weather API call") is recorded on-chain next to the payment. Arc's `CallFrom` keeps the agent as `msg.sender`, so the vault still enforces the agent's rules. | `Memo` events in each payment transaction |
| **Sub-second deterministic finality** | Paid, held or blocked is final in one block. The MCP tool returns the outcome to the agent from a single receipt, and an owner approval releases a held payment just as fast. | Block times between request and receipt |
| **Native stablecoin money model** | The vault holds native USDC (`msg.value`, 18 decimals) — no ERC-20 approvals for the owner or the agent. The contract follows Arc's EVM differences (e.g. never sends to `address(0)`). | `Leash.sol`, `deposit()` / `pay()` |
| **Stable, USDC-denominated fees** | The cost of each agent action is predictable in dollars, so a daily limit means a real dollar budget. | Fees on the demo transactions |
| **Arc Studio** | Contract written and tested in Arc Studio (156 Foundry tests, including check()/pay() agreement and per-payee limits). | Arc Studio project, `contracts/test/` |

### Not built yet (honest roadmap)

- **ERC-8004 agent identity** — register the agent wallet so payees can see which agent is paying.
- **Multicall3From** — add a payee and its limit in one owner signature instead of two.
- **App Kits Unified Balance** — fund the vault from USDC on other chains.
- **Mainnet** — the same contract, deployed from the owner's wallet.
