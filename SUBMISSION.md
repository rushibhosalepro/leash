# DoraHacks submission: Leash

Copy each block into the matching field of "Create a new Build".

---

## Name of your Build

Leash

## Brief description

Your AI agent pays in USDC on Arc by itself. Above your line, it has to ask.

## Tags

Arc, USDC, AI Agents, MCP, Payments, Arc Studio

## Website (https://your-project.com)

https://rushibhosalepro.github.io/leash/

## Links

- GitHub Repo: https://github.com/rushibhosalepro/leash
- Video: (YouTube link, after recording)
- Other: https://studio.arc.io/app/adcf767c-bf30-46c9-91f3-26916a400330

---

## Description (paste into the big editor)

You give an AI agent a card so it can buy API calls while you sleep. At 3 a.m. it decides a "bulk export" is the fastest way to finish the job. In the morning there's a charge you never agreed to, and nothing in between ever said no.

The usual fix is a stricter prompt. A prompt is a request. **Leash puts the rules in a contract on Arc, so the agent can't raise its own limit, add a payee, or approve itself. The contract refuses.**

### What happened on Arc mainnet

The agent tried two payments to the same payee. One went through. One was held. Only the first moved money.

| What the agent tried | What the contract did | Transaction |
|---|---|---|
| $0.05 to DATA API, "1 dataset query" | **Paid alone**, 0.05 USDC moved | [0x2942…da70](https://explorer.arc.io/tx/0x29428fcea41f194ec775a1bbfb7ac76c0765e5ee273a479ebc3dd0a5f370da70) |
| $0.30 to DATA API, "bulk export" | **Held for the owner**, nothing moved (over the $0.25 limit) | [0x2fdc…a7c3](https://explorer.arc.io/tx/0x2fdc2fcc28f12095639a3210f31e007f5cc15c9a9cc1c0b2d54b5f2882e0a7c3) |
| $0.05 again, from the agent server hosted on Render | **Paid alone** | [0xb29f…c439](https://explorer.arc.io/tx/0xb29f7e225f481c6af6ae8d5ed4465d0cf7e455d051ba2888b524d555ca92c439) |

Each agent payment cost about half a cent in fees. Full record with the deploy and payee setup: [DEMO.md](https://github.com/rushibhosalepro/leash/blob/main/DEMO.md).

### How it works

- The owner deposits USDC into a vault and sets two rules: a daily limit and a per-payment limit for each saved payee.
- Any MCP agent (Claude Code, Cursor, anything that speaks MCP) connects with one private link and gets 9 tools: read its rules, check a payment before sending it, pay with a reason, add notes, follow up.
- Every payment ends one of three ways, decided on-chain: **paid alone** (inside the rules), **held** (unknown payee, over a limit, too many this hour) until the owner taps Approve or Deny, or **blocked** (blocked payee or frozen vault).
- The agent's key can only call `pay()`. Everything that loosens the rules is owner-only and reverts for the agent. We tested it: the agent's own key tried to raise its limit and the chain rejected it with `NotOwner`.

### How I used Arc Studio

The contract (`Leash.sol`), its 156 Foundry tests, a 50-case labelled corpus, and the first version of the web app were written and tested in Arc Studio. I deployed that same compiled contract to Arc mainnet from the owner's wallet, since Arc Studio deploys to testnet. The MCP agent server and the final wallet-style UI were built on top locally. Every prompt I sent Arc Studio is in the repo under `arc-studio/prompts/`, and the 16 Arc Studio and Arc RPC issues I hit are written up in [BUGS.md](https://github.com/rushibhosalepro/leash/blob/main/BUGS.md).

### Why Arc

- **USDC is the gas token.** The agent needs one balance, not USDC plus ETH.
- **Memo contract.** Every payment carries the agent's reason on-chain, next to the transfer.
- **Sub-cent fees.** Holding a payment for review costs less than a cent, so asking first is cheap.
- **App Kit (Circle CCTP).** The app has a built-in "Bring USDC to Arc" panel. I funded this vault with it, from Base.

### Required details

- **Arc Studio project:** https://studio.arc.io/app/adcf767c-bf30-46c9-91f3-26916a400330
- **Live app:** https://rushibhosalepro.github.io/leash/
- **Contract (Arc mainnet):** [0xB9D96252a9cAB4CB97159cc395AF3C1597778580](https://explorer.arc.io/address/0xB9D96252a9cAB4CB97159cc395AF3C1597778580)
- **Example transaction:** [0x29428fcea41f194ec775a1bbfb7ac76c0765e5ee273a479ebc3dd0a5f370da70](https://explorer.arc.io/tx/0x29428fcea41f194ec775a1bbfb7ac76c0765e5ee273a479ebc3dd0a5f370da70)
- **Repo:** https://github.com/rushibhosalepro/leash
- **Video:** (YouTube link)

### Limits, said plainly

The contract is tested, not audited, so the live vault holds about $1. Alerts for held payments aren't built yet: today the owner sees them in the app.
