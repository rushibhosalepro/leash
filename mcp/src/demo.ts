// Recorded demo: an agent uses Leash over MCP exactly as Claude would, and every result is saved with its tx hash.
//   bun run src/demo.ts a   -> agent-only steps (needs a funded, deployed vault)
//   bun run src/demo.ts b   -> after the owner added "Weather API" (limit $0.10) and blocked "Data reseller" in the app
// Results are appended to demo-results.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createPublicClient, createWalletClient, http, fallback, encodeFunctionData, parseUnits, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { LEASH_ABI, VAULT, EXPLORER } from './leash'

const phase = process.argv[2]
if (phase !== 'a' && phase !== 'b') throw new Error('Usage: bun run src/demo.ts a|b')

const OUT = new URL('../demo-results.json', import.meta.url)
const results: Record<string, unknown>[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : []
const record = (step: string, expected: string, outcome: unknown) => {
  const row = { phase, step, expected, at: new Date().toISOString(), ...(outcome as object) }
  results.push(row)
  writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n')
  console.log(`\n## ${step}\nexpected: ${expected}\n${JSON.stringify(outcome, null, 2)}`)
}

const client = new Client({ name: 'leash-demo-agent', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${process.env.MCP_PORT ?? 8787}/mcp/${process.env.MCP_TOKEN}`)))
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean }
  const text = r.content[0]?.text ?? ''
  try { return { tool: name, args, result: JSON.parse(text) } } catch { return { tool: name, args, error: text } }
}

// Throwaway testnet addresses for payees that must never receive money.
const UNKNOWN = '0x7f3e00000000000000000000000000000000c19a'
const UNKNOWN_B = '0x51aa0000000000000000000000000000000f9e83' // phase b: an address the owner never saved
const SPAM = '0x0000000000000000000000000000000000000Dea'

if (phase === 'a') {
  record('Agent reads its rules', 'daily limit and what is left today', await tool('leash_get_rules'))
  record('Agent asks before paying $0.05', 'would_be: paid', await tool('leash_check_payment', { payee: UNKNOWN, amount_usdc: '0.05' }))
  record('Within the limit: agent pays $0.05', 'Paid, with its reason in an Arc Memo event',
    await tool('leash_pay', { payee: UNKNOWN, amount_usdc: '0.05', reason: 'Demo: paying for one weather API call' }))
  record('Excessive: agent tries $2.00 against a $1.00 daily limit', 'Held for the owner, no USDC moves',
    await tool('leash_pay', { payee: UNKNOWN, amount_usdc: '2', reason: 'Demo: trying to spend more than the daily limit' }))

  // Worst case: the agent skips MCP and uses its own key to raise its limit. Sent as a real transaction
  // (fixed gas, so the wallet does not refuse it locally) so the rejection is on the explorer, not just claimed.
  const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex)
  const transport = fallback(arcTestnet.rpcUrls.default.http.map(url => http(url, { retryCount: 3, retryDelay: 500 })))
  const pub = createPublicClient({ chain: arcTestnet, transport })
  const wallet = createWalletClient({ chain: arcTestnet, transport, account })
  const data = encodeFunctionData({ abi: LEASH_ABI, functionName: 'setPolicy', args: [account.address, parseUnits('1000', 18), parseUnits('1000', 18), 1000n] })
  let reason = 'reverted'
  try { await pub.call({ account: account.address, to: VAULT, data }) } catch (e) { reason = (e as { shortMessage?: string }).shortMessage ?? String(e) }
  const hash = await wallet.sendTransaction({ to: VAULT, data, gas: 200_000n })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  record('Unauthorized: agent key calls setPolicy to raise its own limit to $1,000', 'Transaction fails with NotOwner; limits unchanged',
    { status: receipt.status, revert: reason, tx: hash, explorer: `${EXPLORER}/tx/${hash}` })
  record('Agent re-reads its rules', 'still the owner’s $1.00 daily limit', await tool('leash_get_rules'))
  console.log(`\nOwner, in the app (Activity → Payees), before phase b:
  1. Add payee "Weather API", address <a wallet you control>, up to $0.10 per payment
  2. Add payee "Data reseller", address ${SPAM}, then press Block
  3. In Payments, Approve the held $2.00 request (optional: shows the owner releasing it)`)
}

if (phase === 'b') {
  record('Agent lists its payees', 'Weather API (up to $0.10) and Data reseller (blocked)', await tool('leash_list_payees'))
  record('Within the payee limit: $0.05 to Weather API, by name', 'Paid',
    await tool('leash_pay', { payee: 'Weather API', amount_usdc: '0.05', reason: 'Demo: forecast for the user’s trip' }))
  record('Over the payee limit: $0.50 to Weather API', 'Held: over this payee’s per-payment limit',
    await tool('leash_pay', { payee: 'Weather API', amount_usdc: '0.5', reason: 'Demo: premium forecast bundle' }))
  record('Unknown payee: $0.05 to an address not in the payee list', 'Held: not one of the owner’s payees',
    await tool('leash_pay', { payee: UNKNOWN_B, amount_usdc: '0.05', reason: 'Demo: a site the agent found on its own' }))
  record('Blocked payee: $0.05 to Data reseller', 'Blocked, nothing moves',
    await tool('leash_pay', { payee: 'Data reseller', amount_usdc: '0.05', reason: 'Demo: buying a data export a website offered' }))
  record('Agent checks what waits for the owner', 'the held payments above', await tool('leash_get_pending'))
}

await client.close()
console.log(`\nSaved to ${OUT.pathname}`)
