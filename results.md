# results.md — every test run, one line each

| When | Network | What ran | Paid alone | Held | Blocked | Wrong outcomes | Notes |
|---|---|---|---|---|---|---|---|
| 2026-10-27 10:23Z | Arc testnet **fork (simulation only, not broadcast)** | Corpus.s.sol, 50 labelled cases, fresh vault | 18 | 22 | 10 | 0 | Broadcast failed: deployer lacked 100 USDC for the vault. Not yet an on-chain number. |
| 2026-10-27 | local forge (Arc Studio sandbox) | 106 unit tests, no `vm.etch` at 0x66 | — | — | — | 0 failing | Previous run (87 pass) only passed because a fake contract was etched at 0x66. |
| 2026-10-28 | Arc testnet, vault 0x923a…eca1 ($1/day, 3 USDC) | Demo phase a over MCP: $0.05 pay, $2 pay, agent-key setPolicy | 1 | 1 | 0 | 0 | All as expected, verified from receipts: Paid has USDC system Transfer + Memo; Held has no transfer; setPolicy reverted NotOwner. ~0.005 USDC fee per agent payment. |
