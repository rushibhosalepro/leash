Redesign the Leash web app to be MINIMAL. A judge should understand it in one glance. Keep every contract call working; this is a layout and copy change.

## Header (always visible, one row)
[Leash logo]  [Testnet | Mainnet switch]  ...........  [Agent link: http://127.0.0.1:8787/mcp/•••• (Copy)]  [Connect wallet]
- Network switch changes chain, vault address and explorer everywhere. If the selected network has no vault yet, show one line: "Not live on mainnet yet." and nothing else.
- Agent link: shown only when the local MCP server answers on http://127.0.0.1:8787/link. Masked by default, Copy button copies the full link. Hover/tooltip: "Paste into Claude Code, Cursor or any MCP agent." If the server is not running: "Agent offline – run `bun run start` in /mcp".

## Only two pages (tabs under the header)
1. Activity (default, no wallet needed)
   - One sentence: "Your AI agent pays on its own. Above the line, it asks."
   - Four numbers from the chain in one row: Paid alone · Held · Blocked · Left today (USDC).
   - A single list of payments, newest first. Each row: outcome badge (green Paid / amber Held / red Blocked), amount, payee (short address), the agent's reason, the rule in plain words when held/blocked, explorer link.
   - If the connected wallet is the owner, held rows get two small buttons right in the row: Approve · Deny (and a checkbox "trust this payee").
2. Rules (owner only; without the owner wallet show the rules read-only)
   - One sentence with inline inputs: "Pay up to [$1] each, [$5] a day, [10] an hour." [Save]
   - Trusted payees: list + add/remove. Blocked payees: list + add/remove.
   - Freeze switch. Vault balance + Deposit / Withdraw.
   - Agent wallet address (change).

## Remove
- The separate landing page, Agent Simulator, playground, demo replay, autonomy hero, any explanatory cards.
- All jargon: no "EOA", "msg.sender", "Memo", "native", "allowlist".

## Style
- Dark, lots of space, one column, max width 760px. Green/amber/red used only for the three outcomes.
- Keep the "Built with Arc Studio" badge small in the footer.

## Done means
- Activity loads with no wallet in under 2 seconds and shows real on-chain rows.
- Owner can approve/deny from Activity and change everything on Rules.
- No `as` casts on contract results; decode with readPolicy / readAutonomy. Lint and typecheck pass.
