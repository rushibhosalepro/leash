# Leash

**Your AI agent pays on its own. Above your line, it has to ask.**

Most agent wallets hand the agent a key and hope. Leash puts the rules in a contract on Arc, so the agent can't raise its own limit, add a payee, or approve itself. The contract refuses.

**Status:** contract and agent live on **Arc mainnet** with real USDC · vault [`0xB9D9…8580`](https://explorer.arc.io/address/0xB9D96252a9cAB4CB97159cc395AF3C1597778580) · built in [Arc Studio](https://studio.arc.io/app/adcf767c-bf30-46c9-91f3-26916a400330) · **live app: [rushibhosalepro.github.io/leash](https://rushibhosalepro.github.io/leash/)** (no wallet needed to look around) · agent server hosted at `leash-agent.onrender.com`.

---

## Why I built it

You give an agent your card so it can buy API calls while you sleep. At 3 a.m. it decides a "bulk export" is the fastest way to finish the job. In the morning there's a charge you never agreed to, and nothing in between ever said no.

The fix people reach for is a smarter prompt. A prompt is a request. I wanted a rule the agent physically can't break, where small payments go through on their own and anything bigger waits for a human.

## The headline

On Arc mainnet the agent tried two payments to the same payee. **One went through. One was held. Only the first moved money.**

| What the agent tried | What the contract did | Why | Transaction |
|---|---|---|---|
| **$0.05** to `DATA API`, "1 dataset query" | **Paid alone**, 0.05 USDC moved | inside every rule | [`0x2942…da70`](https://explorer.arc.io/tx/0x29428fcea41f194ec775a1bbfb7ac76c0765e5ee273a479ebc3dd0a5f370da70) |
| **$0.30** to `DATA API`, "bulk export" | **Held for the owner**, nothing moved | over the $0.25 per-payment limit | [`0x2fdc…a7c3`](https://explorer.arc.io/tx/0x2fdc2fcc28f12095639a3210f31e007f5cc15c9a9cc1c0b2d54b5f2882e0a7c3) |

Balances afterwards, checked on-chain: vault **0.95**, payee **0.05**. The held $0.30 sits in the vault until the owner taps Approve or Deny. Each agent payment cost **about half a cent** in fees.

The full record, including the deploy, the payee setup and the earlier testnet runs, is in [DEMO.md](DEMO.md). Every test run is logged one line at a time in [results.md](results.md).

## How it works

```
 Any MCP agent  ──(agent link)──>  Leash MCP server  ──signs──>  Arc Memo contract  ──>  Leash vault
 (Claude Code,                     (holds only the               (reason stored         (decides: paid,
  Cursor, ...)                      agent's key)                  on-chain)              held or blocked)
                                                                                              ▲
 Owner in the web app  ──MetaMask──>  approve · deny · limits · payees · freeze · withdraw ──┘
```

Every payment ends one of three ways, and the agent learns which before it spends anything (`leash_check_payment`):

| Outcome | When | Money moves? |
|---|---|---|
| **Paid alone** | payee is saved, amount is within its per-payment limit and what's left today | yes, immediately |
| **Held** | unknown payee, over a limit, or too many payments this hour | no, waits for the owner |
| **Blocked** | payee is blocked or the vault is frozen | never |

## The part I'm proudest of: the agent can't talk its way out

The agent's key can call exactly one thing that moves money, `pay()`. Everything that loosens the rules is `onlyOwner`, so it reverts when the agent tries it. That isn't a check in the prompt or the server. It's in the contract.

I tested it on purpose. On testnet the agent's own key called `setPolicy` to raise its limit, and the chain rejected it with `NotOwner` ([`0x8fd9…a2f0`](https://testnet.arcscan.app/tx/0x8fd901bd3d902b885890f1843a29bd3a83c08d116b44ddd642e1c63d2124a2f0), see [DEMO.md](DEMO.md)). The MCP server goes further: it doesn't expose any tool that changes a rule, so there's nothing to aim a prompt injection at.

What the agent **can** do: pay with a reason, check a payment first, list its payees and rules, see what's left today, add a note to a payment.
What it **can never** do: raise a limit, add or unblock a payee, unfreeze, approve its own held payment, or withdraw.

## Why Arc

| Arc feature | What it does for Leash |
|---|---|
| **USDC is the gas token** | The agent needs one balance, not USDC plus ETH. Its wallet holds a few cents and that's all. |
| **Memo contract** | Every payment carries the agent's reason on-chain, next to the transfer. The activity feed reads it straight from the chain. |
| **Sub-cent fees** | Measured: $0.0043 for a paid payment, $0.0053 for a held one. Holding a payment for review costs less than a cent. |
| **App Kit (Circle CCTP)** | The app has a built-in "Bring USDC to Arc" panel. I funded this vault with it: 2.9 USDC from Base, 0.017 USDC in fees. |
| **Arc Studio** | Wrote and tested the contract (156 tests) and built the first version of the app. |

## How this maps to the judging criteria

| Criterion | Where to look |
|---|---|
| **Real USDC on Arc mainnet (30%)** | Vault [`0xB9D9…8580`](https://explorer.arc.io/address/0xB9D96252a9cAB4CB97159cc395AF3C1597778580), five mainnet transactions in [DEMO.md](DEMO.md): deploy, two payee setups, one paid, one held |
| **Arc Studio across the build (25%)** | Project [studio.arc.io/app/adcf767c…](https://studio.arc.io/app/adcf767c-bf30-46c9-91f3-26916a400330). Contract, 156 Foundry tests, 50-case corpus and first app all built there. The prompts I sent are in [arc-studio/prompts/](arc-studio/prompts/) |
| **Working product (25%)** | [Live web app](https://rushibhosalepro.github.io/leash/) (wallet, approvals, payees, limits, freeze, bridge) plus an MCP server any agent can connect to with one link |
| **Potential (20%)** | Any agent framework that speaks MCP gets a spending account with a human gate, no code changes. See "What's next" |

## Results

| Run | Paid alone | Held | Blocked | Wrong |
|---|---|---|---|---|
| Arc mainnet, real USDC, 3 agent payments (one through the hosted server) | 2 | 1 | 0 | 0 |
| Arc testnet demo over MCP, 4 agent payments | 2 | 2 | 0 | 0 |
| 50 labelled cases on a fresh vault (Arc testnet fork) | 18 | 22 | 10 | **0** |
| Same 50 cases broadcast on Arc testnet | 6 | 34 | 10 | **12** |
| Foundry unit tests | 156 pass | | | 0 fail |

The 12 wrong cases are worth explaining. The on-chain corpus run was interrupted mid-way and resumed on the same vault, so its hourly and daily counters were already used up. All 12 are "expected paid, got held". The contract erred on the side of asking, which is the direction you want, and on a fresh vault the same 50 cases come out 0 wrong.

## Run it

**Fastest:** open [rushibhosalepro.github.io/leash](https://rushibhosalepro.github.io/leash/). It reads the live mainnet vault straight from Arc, and the agent server runs on Render, so nothing needs to run on your machine. The owner signs in with the owner wallet to see the agent link.

To run it yourself (needs [Bun](https://bun.sh)):

```bash
git clone https://github.com/rushibhosalepro/leash.git
cd leash/app
bun install
bun run dev
```

Open http://localhost:5173. It shows the mainnet vault, its payments and the held request. Connect the owner wallet to manage it.

To run your own agent, start the MCP server in a second terminal:

```bash
cd leash/mcp
bun install
bun run init-agent
bun run start
```

`init-agent` creates the agent wallet and a secret link token in `mcp/.env` and prints only the public address. Then:

1. **Your own vault.** Set `vault: null` for mainnet in `app/src/network.tsx` and the app shows a **Deploy vault** screen: your wallet signs the deploy and becomes the owner, the agent address is filled in from the server. Put the new address and block in `mcp/.env` (names in `mcp/.env.example`).
2. **Fees for the agent.** Send its wallet about $0.20 of USDC on Arc. That's all it ever holds.
3. **Connect an agent.** The app's **Connect your agent** panel shows the exact command for Claude Code and Cursor, with your link already in it. Copy it and run it.

Contract tests (needs [Foundry](https://getfoundry.sh)):

```bash
cd leash/app
forge test
```

## Environment (`mcp/.env`)

| Name | What it's for |
|---|---|
| `AGENT_PRIVATE_KEY` | The agent's own wallet. Created by `init-agent`, never printed. |
| `MCP_TOKEN` | Secret part of the agent link. Rotate it from the app. |
| `LEASH_NETWORK` | `mainnet` or `testnet` |
| `LEASH_MAINNET_ADDRESS`, `LEASH_MAINNET_FROM_BLOCK` | Mainnet vault and its deploy block |
| `LEASH_ADDRESS`, `LEASH_FROM_BLOCK` | Testnet vault and its deploy block |
| `MCP_PORT`, `LINK_ENABLED`, `APP_ORIGINS` | Optional: port, link on/off, which app origins may manage the link |

## Stack

| Layer | What's running |
|---|---|
| Contract | `Leash.sol`, Solidity 0.8.28, Foundry. One vault per owner and agent |
| Chain | Arc mainnet (5042) and testnet (5042002), native USDC, Arc Memo contract |
| Agent server | Bun, `@modelcontextprotocol/sdk` (Streamable HTTP), viem, SQLite for notes and failed attempts. Hosted on Render (Docker, free plan), kept awake by a GitHub Actions ping |
| Web app | React 18, Vite, wagmi v2, viem, ConnectKit, Tailwind |
| Bridge | Arc App Kit (`@circle-fin/app-kit`), CCTP with the Forwarding Service |

## Layout

```
app/
  contracts/Leash.sol      the vault: policy, pay, hold, approve, deny, freeze
  contracts/test/          156 Foundry tests (access, caps, payee limits, reentrancy, ...)
  contracts/script/        50-case labelled corpus
  src/components/          Wallet, Settings, Payees, ConnectAgent, DeployVault, BridgeToArc
  src/feed.ts              activity feed rebuilt from on-chain events
mcp/
  src/server.ts            9 MCP tools, link control, app API
  src/leash.ts             reads rules, checks and sends payments through Memo
  src/db.ts                local notes and failed attempts
arc-studio/prompts/        the prompts sent to Arc Studio
DEMO.md                    recorded runs with explorer links
results.md                 one line per test run
BUGS.md                    16 Arc Studio and Arc RPC issues found while building
```

## What broke along the way

- **Arc Studio's tests passed against a fake.** The first contract called a memo "precompile" at `0x66` that doesn't exist on Arc. The tests passed only because they `vm.etch`ed a fake contract there. I moved payments onto Arc's real Memo contract and the test count went from 87 passing to 106, then 156.
- **The app went blank the moment a wallet connected.** viem returns `policy()` as a tuple, and the generated code read it as an object. Fixed with a small `readPolicy` helper and an error boundary.
- **Mainnet showed one event out of five.** On Arc mainnet RPCs, `eth_getLogs` with no `toBlock` returns only the oldest match, and viem leaves `toBlock` out by default. Testnet never showed it. Every event query now passes `toBlock: 'latest'`.
- **Arc Studio's agent printed a private key** right after being told not to. The key belonged to a test wallet and is not used for anything real.

All 16 are written up with steps to reproduce in [BUGS.md](BUGS.md), ready to send to the Arc team.

## Limits, said plainly

- The contract is tested, not audited. Use small amounts.
- The hosted agent server holds the agent key as a Render secret. If it leaks, the contract still caps it: $0.25 a payment, $1 a day, only to saved payees, and Freeze stops it instantly. Only the owner, after a wallet signature, can see the agent link or change server settings.
- The daily limit is a rolling 24 hours from the first payment, not calendar days.
- Alerts (email or push when a payment is held) aren't built yet. Today the owner sees held payments in the app.

## What's next

- Alerts when something is held, with approve and deny from the notification.
- Approve held payments from a phone notification.
- A vault factory, so one owner can give each agent its own leash.
