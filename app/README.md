# Leash web app and contract

This folder holds the Leash contract (`contracts/`), its Foundry tests, and the web app (`src/`).
Arc Studio generated the first version of both; see the [root README](../README.md) for what Leash does,
the live Arc mainnet vault, and how to run everything.

```bash
bun install
bun run dev      # web app on http://localhost:5173
forge test       # 156 contract tests
```
