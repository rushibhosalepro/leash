# results.md — every test run, one line each

| When | Network | What ran | Paid alone | Held | Blocked | Wrong outcomes | Notes |
|---|---|---|---|---|---|---|---|
| 2026-10-27 10:23Z | Arc testnet **fork (simulation only, not broadcast)** | Corpus.s.sol, 50 labelled cases, fresh vault | 18 | 22 | 10 | 0 | Broadcast failed: deployer lacked 100 USDC for the vault. Not yet an on-chain number. |
| 2026-10-27 | local forge (Arc Studio sandbox) | 106 unit tests, no `vm.etch` at 0x66 | — | — | — | 0 failing | Previous run (87 pass) only passed because a fake contract was etched at 0x66. |
| 2026-10-28 | Arc testnet, vault 0x923a…eca1 ($1/day, 3 USDC) | Demo phase a over MCP: $0.05 pay, $2 pay, agent-key setPolicy | 1 | 1 | 0 | 0 | All as expected, verified from receipts: Paid has USDC system Transfer + Memo; Held has no transfer; setPolicy reverted NotOwner. ~0.005 USDC fee per agent payment. |
| 2026-10-28 | Arc testnet, vault 0x923a…eca1 | Demo phase b1 over MCP: pay weather API by name, pay unknown address | 1 | 1 | 0 | 0 | Verified from receipts: Paid has USDC system Transfer + Memo; Held has no transfer; payee balances 2.10 and 0. Earlier double approve reverted AlreadySettled. |
| 2026-10-29 | **Arc mainnet**, vault 0xB9D9…8580 ($0.25 per payment, $1/day, 1 USDC real) | Agent over MCP: $0.05 to DATA API, then $0.30 to DATA API | 1 | 1 | 0 | 0 | Verified on-chain: vault 0.95, payee 0.05, held payment moved nothing. Fees 0.0043 and 0.0053 USDC. Paid tx 0x2942…da70, held tx 0x2fdc…a7c3. |
