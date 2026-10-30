# Leash: walkthrough script (after the 40 s intro)

Target: about 2 min 15 s of explanation, so the whole video is about 3 minutes.
The submission requires two things on screen: **the build in Arc Studio** and **a mainnet transaction**. Both are below (parts 2 and 4).

Speak plainly, like you're showing a friend. Each part lists **what to show** and **what to say**.

---

## Before you record (10 minutes)

- [ ] Open these tabs, in this order:
  1. Live app: https://rushibhosalepro.github.io/leash/ (MetaMask connected as the owner, `0x5866…8ea0`, network **Arc**)
  2. Arc Studio project: https://studio.arc.io/app/adcf767c-bf30-46c9-91f3-26916a400330
  3. Explorer: https://explorer.arc.io/address/0xB9D96252a9cAB4CB97159cc395AF3C1597778580
- [ ] In the app, Connect your agent → **Show agent link · sign with your wallet**. Copy the link (keep it off screen, or blur it later).
- [ ] Start MCP Inspector in a terminal and connect it with that link (transport: **Streamable HTTP**):
  ```bash
  npx @modelcontextprotocol/inspector
  ```
- [ ] Optional: a Claude Code window with Leash connected (`claude mcp add --transport http leash <link>`).
- [ ] Money check: agent wallet has ~0.19 USDC for fees, vault has ~0.90. Enough for the whole video.
- [ ] Hide anything private: the agent link, other browser tabs, notifications.

---

## 1. The app, at a glance (0:40 – 1:00)

**Show:** the live app on Mainnet. Hover over each part as you name it.

**Say:**
> "This is Leash, live on Arc mainnet. The vault holds the money the agent can spend, real USDC.
> Up here is the agent's own wallet. It's a separate address that only holds a few cents for fees and signs payments.
> The rules are simple: a daily limit, and a per-payment limit for each payee. This bar shows how much of today's limit is left.
> Every payment lands in one of three buckets: paid alone, held for me, or blocked."

---

## 2. Built in Arc Studio (1:00 – 1:20)

**Show:** the Arc Studio project. Open `contracts/Leash.sol`, then the test results (or the tests folder), then scroll the chat history briefly.

**Say:**
> "I built the contract in Arc Studio. It wrote Leash.sol, and 156 tests covering limits, payees, access control and reentrancy, plus a 50-case test set of payments that should be paid, held or blocked.
> I deployed that same compiled contract to Arc mainnet from my own wallet, so I'm the owner. Studio deploys to testnet.
> Every prompt I sent Studio is in the repo, and so are the 16 bugs I hit along the way."

---

## 3. Connecting an agent (1:20 – 1:40)

**Show:** the Connect your agent panel → the link appears after the wallet signature. Then Claude Code (or MCP Inspector's **Tools** list).

**Say:**
> "Any MCP agent connects with one link. Claude Code, Cursor, anything.
> The link is private, so only the owner sees it after signing with the owner wallet.
> The agent gets nine tools: read its rules, check a payment before sending it, pay with a reason, add notes, follow up.
> None of them can change a rule."

If you use Claude Code, ask it: *"What are my spending rules?"* and *"Would a 5 cent payment to DATA API go through?"*. It answers from `leash_get_rules` and `leash_check_payment`: **would be paid**.

---

## 4. A real payment on mainnet (1:40 – 2:10)

**Show:** MCP Inspector → **Tools → leash_pay**.

1. payee `DATA API`, amount_usdc `0.05`, reason `1 dataset query` → **Run** → result `"outcome": "paid"`.
2. Switch to the app: the payment appears in Activity as **PAID ALONE** within ~15 s.
3. Click its ↗ link → **explorer.arc.io** opens the transaction. Point at the transfer and the reason.
4. Back in the Inspector: `0.30`, reason `bulk export` → **Run** → `"outcome": "held"`, rule `per_payment_cap`.
5. The app shows **YOUR AGENT IS ASKING: Pay $0.30 to DATA API?**

**Say:**
> "Here's the agent paying for real. Five cents to the data API, inside the rules, so the contract pays it on its own. That's real USDC on Arc mainnet, and here's the transaction on the explorer, with the agent's reason on-chain next to it.
> Now thirty cents. That's over the limit, so the contract holds it. Nothing moved. It waits for me."

---

## 5. The owner decides (2:10 – 2:25)

**Show:** the held card → click **Deny** (or **Approve**) → confirm in MetaMask → the card disappears and the row updates.

**Say:**
> "I'm the only one who can answer. I'll deny this one. If I approved it, the contract would pay it right then.
> And if something ever looks wrong, Freeze stops every payment instantly."

(Hover over the Freeze tile. Don't click it unless you want to unfreeze after.)

---

## 6. What the agent can't do (2:25 – 2:40)

**Show:** Settings (owner only) → then the NotOwner transaction from DEMO.md on the testnet explorer, or just the README section.

**Say:**
> "The agent's key can call exactly one thing that moves money: pay.
> Raising a limit, adding a payee, approving its own payment: all owner-only, in the contract. When the agent's key tried to raise its own limit, the chain rejected it with NotOwner.
> It's not a prompt asking the agent to behave. It's a rule it can't break."

---

## 7. Why Arc (2:40 – 2:55)

**Show:** the explorer transaction again (fee), then the "Bring USDC to Arc" panel on the Deploy screen if you want.

**Say:**
> "Arc makes this work. USDC is the gas token, so the agent needs one balance, not USDC plus ETH.
> Fees are under a cent, so holding a payment for a human costs almost nothing.
> Arc's Memo contract puts the agent's reason on-chain with every payment.
> And I funded this vault from Base with Circle's bridge, built right into the app."

---

## 8. Close (2:55 – 3:00)

**Show:** the live app, then a title card or just the URL.

**Say:**
> "Leash. Give your agent a wallet, not unlimited power.
> It's live at rushibhosalepro.github.io/leash, and the code is on GitHub."

---

## If something goes wrong while recording

| Problem | Fix |
|---|---|
| Agent server slow on first call (Render waking up) | Open https://leash-agent.onrender.com/health a minute before recording |
| Inspector won't connect | Transport must be **Streamable HTTP**; paste the full link including `/mcp/…` |
| MetaMask "rate limited" | Retry; it's the public Arc RPC |
| Payment shows in Inspector but not in the app | Wait 15 s; the app refreshes every 15 s |
| Agent link not shown | Connect the owner wallet first, then click **Show agent link · sign with your wallet** |
