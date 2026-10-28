/**
 * run-corpus-onchain.ts
 *
 * RESUMABLE onchain corpus runner for Leash.
 *
 * Reuses existing vaults instead of deploying new ones.
 * Reconstructs already-completed cases from on-chain events.
 * Withdraws from stale vaults before running.
 * Checks wallet balance before every tx and stops gracefully if low.
 *
 * Fixed vaults (last run):
 *   vaultMain  = 0xb1dc5Ebf7993428da0E53764baD49bE2258402B4
 *   vaultDaily = 0x417B03c47Bd7a86f3fB562f95db7E6eC5433768F
 *
 * Stale vaults to drain first:
 *   0x5a70b756304602E3569FDB5Fa50333b55fE56C17  (2 USDC)
 *   0x820475Eed108Ffe8005A28f75DBdef56096Cb8E6  (1 USDC)
 *
 * Usage:
 *   LEASH_PRIVATE_KEY=0x... bun run scripts/run-corpus-onchain.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseAbiItem,
  encodeAbiParameters,
  keccak256,
  toBytes,
  toHex,
  formatUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ─── Config ─────────────────────────────────────────────────────────────────

const MEMO_ADDRESS  = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as const
const VAULT_MAIN    = '0xb1dc5Ebf7993428da0E53764baD49bE2258402B4' as const
const VAULT_DAILY   = '0x417B03c47Bd7a86f3fB562f95db7E6eC5433768F' as const
const STALE_VAULTS  = [
  '0x5a70b756304602E3569FDB5Fa50333b55fE56C17' as const,
  '0x820475Eed108Ffe8005A28f75DBdef56096Cb8E6' as const,
]

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.testnet.arc.io'

const PRIVATE_KEY = process.env.LEASH_PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) {
  console.error('ERROR: set LEASH_PRIVATE_KEY=0x...')
  process.exit(1)
}

// Amounts — same as the deployed vaults were configured with
const NATIVE_FACTOR = 10n ** 12n
const PER_CAP       = 50_000n  * NATIVE_FACTOR   // 0.05 USDC
const DAILY_MAIN    = 10_000_000n * NATIVE_FACTOR // 10 USDC (unlimited for corpus)
const MAX_PER_HOUR  = 3n

const SMALL = 1_000n  * NATIVE_FACTOR   // 0.001 USDC
const MED   = 20_000n * NATIVE_FACTOR   // 0.02  USDC

const API_VENDOR  = '0x0000000000000000000000000000000000000a01' as `0x${string}`
const API_VENDOR2 = '0x0000000000000000000000000000000000000a02' as `0x${string}`
const UNKNOWN1    = '0x0000000000000000000000000000000000000B01' as `0x${string}`
const BLOCKED1    = '0x0000000000000000000000000000000000000C01' as `0x${string}`

// Minimum balance to keep in wallet before stopping (gas buffer)
const MIN_GAS_RESERVE = 100_000n * NATIVE_FACTOR  // 0.1 USDC

// ─── ABIs ────────────────────────────────────────────────────────────────────

const LEASH_ABI = parseAbi([
  'function pay(address payee, uint256 amount, string reason) external',
  'function setAllowlist(address[] payees, bool allowed) external',
  'function setDenylist(address[] payees, bool denied) external',
  'function setPolicy(address agent, uint256 perPaymentCap, uint256 dailyCap, uint256 maxPerHour) external',
  'function freeze() external',
  'function unfreeze() external',
  'function withdraw(uint256 amount) external',
  'function withdrawAll() external',
  'function paidAlone() external view returns (uint256)',
  'function heldCount() external view returns (uint256)',
  'function blockedCount() external view returns (uint256)',
  'function frozen() external view returns (bool)',
])

const MEMO_ABI = parseAbi([
  'function memo(address target, bytes data, bytes32 memoId, bytes memoData) external',
])

// Typed event ABIs for getLogs
const PAID_EVENT    = parseAbiItem('event Paid(uint256 indexed id, address indexed payee, uint256 amount, string reason)')
const HELD_EVENT    = parseAbiItem('event HeldForReview(uint256 indexed id, address indexed payee, uint256 amount, string reason, string ruleBroken)')
const BLOCKED_EVENT = parseAbiItem('event Blocked(uint256 indexed id, address indexed payee, uint256 amount, string reason, string ruleBroken)')

// ─── Types ───────────────────────────────────────────────────────────────────

type Outcome = 'Paid' | 'Held' | 'Blocked' | 'other'

interface CaseResult {
  label: string
  expected: Outcome
  actual: Outcome
  txHash: string
}

// ─── Client setup ─────────────────────────────────────────────────────────────

const account     = privateKeyToAccount(PRIVATE_KEY)
const transport   = http(RPC_URL, { retryCount: 5, retryDelay: 2000 })
const publicClient  = createPublicClient({ chain: arcTestnet, transport })
const walletClient  = createWalletClient({ account, chain: arcTestnet, transport })

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function walletBalance(): Promise<bigint> {
  return publicClient.getBalance({ address: account.address })
}

/** Abort if wallet is below MIN_GAS_RESERVE. */
async function assertFunds(label: string) {
  const bal = await walletBalance()
  if (bal < MIN_GAS_RESERVE) {
    throw new Error(`[${label}] wallet balance ${formatUnits(bal, 18)} USDC below reserve — stopping`)
  }
}

function encodePayCall(payee: `0x${string}`, amount: bigint, reason: string): `0x${string}` {
  const selector = keccak256(toBytes('pay(address,uint256,string)')).slice(0, 10) as `0x${string}`
  const params = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'string' }],
    [payee, amount, reason],
  )
  return (selector + params.slice(2)) as `0x${string}`
}

async function waitTx(hash: `0x${string}`): Promise<`0x${string}`> {
  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
  return hash
}

async function directPay(vault: `0x${string}`, payee: `0x${string}`, amount: bigint, reason: string) {
  const hash = await walletClient.writeContract({
    address: vault, abi: LEASH_ABI, functionName: 'pay', args: [payee, amount, reason],
  })
  return waitTx(hash)
}

async function memoPay(vault: `0x${string}`, payee: `0x${string}`, amount: bigint, reason: string) {
  const data     = encodePayCall(payee, amount, reason)
  const memoId   = keccak256(toBytes(reason))
  const memoData = toHex(new TextEncoder().encode(reason))
  const hash = await walletClient.writeContract({
    address: MEMO_ADDRESS, abi: MEMO_ABI, functionName: 'memo',
    args: [vault, data, memoId, memoData],
  })
  return waitTx(hash)
}

async function counters(vault: `0x${string}`) {
  const [pa, hc, bc] = await Promise.all([
    publicClient.readContract({ address: vault, abi: LEASH_ABI, functionName: 'paidAlone' }),
    publicClient.readContract({ address: vault, abi: LEASH_ABI, functionName: 'heldCount' }),
    publicClient.readContract({ address: vault, abi: LEASH_ABI, functionName: 'blockedCount' }),
  ])
  return { pa: pa as bigint, hc: hc as bigint, bc: bc as bigint }
}

async function outcomeFrom(
  vault: `0x${string}`,
  before: { pa: bigint; hc: bigint; bc: bigint },
): Promise<Outcome> {
  const after = await counters(vault)
  if (after.pa === before.pa + 1n) return 'Paid'
  if (after.hc === before.hc + 1n) return 'Held'
  if (after.bc === before.bc + 1n) return 'Blocked'
  return 'other'
}

/**
 * Fetch all Paid/Held/Blocked events for a vault in a block range.
 * Returns map: requestId (sequential, < 10000) -> { type, txHash }
 * Uses separate getLogs calls with delays to avoid rate limits.
 */
async function fetchVaultEvents(
  vault: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Map<bigint, { type: Outcome; txHash: `0x${string}` }>> {
  const result = new Map<bigint, { type: Outcome; txHash: `0x${string}` }>()
  type AnyEvent = typeof PAID_EVENT | typeof HELD_EVENT | typeof BLOCKED_EVENT
  const entries: [Outcome, AnyEvent][] = [
    ['Paid',    PAID_EVENT],
    ['Held',    HELD_EVENT],
    ['Blocked', BLOCKED_EVENT],
  ]
  for (const [type, event] of entries) {
    await sleep(1200)
    try {
      const logs = await publicClient.getLogs({ address: vault, event, fromBlock, toBlock })
      for (const l of logs) {
        const id = l.args.id as bigint | undefined
        if (id !== undefined && id < 10000n && !result.has(id)) {
          result.set(id, { type, txHash: l.transactionHash as `0x${string}` })
        }
      }
    } catch {
      // rate limit — resumption logic handles missing entries
    }
  }
  return result
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Wallet: ${account.address}`)
  const balStart = await walletBalance()
  console.log(`Balance: ${formatUnits(balStart, 18)} USDC`)
  console.log()

  // ── Step 0: Ensure wallet has enough gas ─────────────────────────────────────
  // If wallet balance is too low to call withdrawAll on stale vaults, first
  // withdraw a small amount from vaultMain (which we own and has funds).
  const GAS_BOOTSTRAP = 200_000n * NATIVE_FACTOR  // 0.2 USDC gas bootstrap
  {
    const curBal = await walletBalance()
    if (curBal < MIN_GAS_RESERVE) {
      const vaultBal = await publicClient.getBalance({ address: VAULT_MAIN })
      if (vaultBal >= GAS_BOOTSTRAP) {
        console.log(`Wallet low (${formatUnits(curBal, 18)} USDC) — bootstrapping gas from vaultMain…`)
        try {
          const h = await walletClient.writeContract({
            address: VAULT_MAIN, abi: LEASH_ABI, functionName: 'withdraw',
            args: [GAS_BOOTSTRAP],
          })
          await waitTx(h)
          const newBal = await walletBalance()
          console.log(`  Gas bootstrap done — wallet now ${formatUnits(newBal, 18)} USDC`)
          await sleep(2000)
        } catch (e: unknown) {
          console.warn(`  Gas bootstrap failed: ${(e as { shortMessage?: string })?.shortMessage ?? String(e)}`)
          console.warn('  Proceeding — will stop when balance runs out')
        }
      }
    }
  }

  // ── Step 1: Recover funds from stale vaults ─────────────────────────────────
  console.log('=== STEP 1: Withdraw from stale vaults ===')
  for (const vault of STALE_VAULTS) {
    const vaultBal = await publicClient.getBalance({ address: vault })
    if (vaultBal > 0n) {
      console.log(`  Withdrawing ${formatUnits(vaultBal, 18)} USDC from ${vault}…`)
      try {
        const h = await walletClient.writeContract({
          address: vault, abi: LEASH_ABI, functionName: 'withdrawAll', args: [],
        })
        await waitTx(h)
        console.log(`  Done — tx ${h.slice(0, 18)}`)
      } catch (e: unknown) {
        console.error(`  WARN: withdrawAll failed on ${vault}: ${(e as { shortMessage?: string })?.shortMessage ?? String(e)}`)
      }
      await sleep(2000)
    } else {
      console.log(`  ${vault} already empty, skipping`)
    }
  }
  const balAfterWithdraw = await walletBalance()
  console.log(`\nWallet balance after withdrawals: ${formatUnits(balAfterWithdraw, 18)} USDC`)
  console.log()

  // ── Step 2: Load existing results file (if any) ──────────────────────────────
  const outPath = join(process.cwd(), 'corpus-results.json')
  let results: CaseResult[] = []
  const completedLabels = new Set<string>()
  if (existsSync(outPath)) {
    try {
      const saved = JSON.parse(readFileSync(outPath, 'utf8')) as { cases?: CaseResult[] }
      results = saved.cases ?? []
      for (const r of results) completedLabels.add(r.label)
      console.log(`Loaded ${results.length} completed cases from corpus-results.json`)
    } catch { /* ignore parse errors */ }
  }

  // ── Step 3: Read current on-chain counters ───────────────────────────────────
  console.log('Reading on-chain counters…')
  const ctrsMain  = await counters(VAULT_MAIN)
  const ctrsDaily = await counters(VAULT_DAILY)
  console.log(`vaultMain:  paid=${ctrsMain.pa} held=${ctrsMain.hc} blocked=${ctrsMain.bc}`)
  console.log(`vaultDaily: paid=${ctrsDaily.pa} held=${ctrsDaily.hc} blocked=${ctrsDaily.bc}`)
  console.log()

  // ── Step 4: Fetch existing tx hashes from events ─────────────────────────────
  // We attempt a log fetch to reconstruct tx hashes for already-sent cases.
  // If RPC rate-limits us, we fall back to sentinel '0xresume' markers.
  console.log('Fetching existing event tx hashes (may be slow — rate limit throttle active)…')
  const latest = await publicClient.getBlockNumber()
  const fromBlock = latest > 2000n ? latest - 2000n : 0n
  const mainEvents  = await fetchVaultEvents(VAULT_MAIN,  fromBlock, latest)
  const dailyEvents = await fetchVaultEvents(VAULT_DAILY, fromBlock, latest)
  console.log(`  Recovered ${mainEvents.size} vaultMain events, ${dailyEvents.size} vaultDaily events`)
  console.log()

  // ── Corpus case tracking ─────────────────────────────────────────────────────
  let totalPaid = 0, totalHeld = 0, totalBlocked = 0, wrongCount = 0

  // Re-tally from already-loaded results
  for (const r of results) {
    if (r.actual === 'Paid')         totalPaid++
    else if (r.actual === 'Held')    totalHeld++
    else if (r.actual === 'Blocked') totalBlocked++
    if (r.actual !== r.expected)     wrongCount++
  }

  /** Record a case as completed without sending a new tx (from existing event). */
  function recordExisting(label: string, expected: Outcome, actual: Outcome, txHash: string) {
    if (completedLabels.has(label)) return // already in file
    console.log(`  [RESUME] ${actual === expected ? '[PASS]' : '[FAIL]'} ${label}  expected:${expected}  actual:${actual}  tx:${txHash.slice(0, 18)}…`)
    if (actual === 'Paid')         totalPaid++
    else if (actual === 'Held')    totalHeld++
    else if (actual === 'Blocked') totalBlocked++
    if (actual !== expected)       wrongCount++
    results.push({ label, expected, actual, txHash })
    completedLabels.add(label)
  }

  let stopped = false

  /** Send a new transaction for a case not yet completed. */
  async function runCase(
    label: string,
    expected: Outcome,
    fn: () => Promise<`0x${string}`>,
    vault: `0x${string}`,
  ) {
    if (stopped) return
    if (completedLabels.has(label)) return // already done

    await assertFunds(label)
    await sleep(1500)

    const before = await counters(vault)
    let txHash: `0x${string}` = '0x'
    try {
      txHash = await fn()
    } catch (err: unknown) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        ?? (err as Error)?.message ?? String(err)
      if (msg.includes('below reserve')) {
        stopped = true
        console.error(`  STOPPED: ${msg}`)
        return
      }
      console.error(`  EXEC ERROR [${label}]: ${msg.slice(0, 120)}`)
    }

    const actual = await outcomeFrom(vault, before)
    const pass   = actual === expected
    if (!pass) wrongCount++

    if (actual === 'Paid')         totalPaid++
    else if (actual === 'Held')    totalHeld++
    else if (actual === 'Blocked') totalBlocked++

    console.log(`  ${pass ? '[PASS]' : '[FAIL]'} ${label}  expected:${expected}  actual:${actual}  tx:${txHash.slice(0, 18)}…`)
    results.push({ label, expected, actual, txHash })
    completedLabels.add(label)

    // Checkpoint after every tx
    saveResults()
  }

  function saveResults() {
    const ctrsMainNow  = { paidAlone: ctrsMain.pa.toString(),  heldCount: ctrsMain.hc.toString(),  blockedCount: ctrsMain.bc.toString() }
    const ctrsDailyNow = { paidAlone: ctrsDaily.pa.toString(), heldCount: ctrsDaily.hc.toString(), blockedCount: ctrsDaily.bc.toString() }
    const out = {
      vaultMain:  VAULT_MAIN,
      vaultDaily: VAULT_DAILY,
      ranAt: new Date().toISOString(),
      totals: { paid: totalPaid, held: totalHeld, blocked: totalBlocked,
        total: totalPaid + totalHeld + totalBlocked, wrong: wrongCount },
      onchain: { vaultMain: ctrsMainNow, vaultDaily: ctrsDailyNow },
      cases: results,
    }
    writeFileSync(outPath, JSON.stringify(out, null, 2))
  }

  // ── GROUP 1: In-policy (10 cases) — vaultMain ─────────────────────────────
  // paidAlone counter started at 0; first 3 paid (rate limit = 3/hr), rest held
  // IDs 1-15 on vaultMain: paid=3, held=12
  console.log('--- GROUP 1: In-policy payments ---')
  for (let i = 1; i <= 5; i++) {
    const label = `1.${i} in-policy via Memo`
    // IDs 1-5 in vaultMain events
    const ev = mainEvents.get(BigInt(i))
    if (ev) {
      // actual: first 3 paid, then held due to rate limit
      recordExisting(label, 'Paid', ev.type, ev.txHash)
    } else {
      await runCase(label, 'Paid',
        () => memoPay(VAULT_MAIN, API_VENDOR, MED, `pay API vendor $0.02 via Memo — request #${i}`),
        VAULT_MAIN)
    }
  }
  for (let i = 6; i <= 10; i++) {
    const label = `1.${i} in-policy direct`
    const ev = mainEvents.get(BigInt(i))
    if (ev) {
      recordExisting(label, 'Paid', ev.type, ev.txHash)
    } else {
      await runCase(label, 'Paid',
        () => directPay(VAULT_MAIN, API_VENDOR2, MED, `in-policy direct #${i}`),
        VAULT_MAIN)
    }
  }

  // ── GROUP 2: Over per-payment cap (5 cases) — vaultMain ───────────────────
  console.log('\n--- GROUP 2: Over per-payment cap ---')
  for (let i = 1; i <= 5; i++) {
    const label = `2.${i} over per-payment cap`
    const ev = mainEvents.get(BigInt(10 + i))
    if (ev) {
      recordExisting(label, 'Held', ev.type, ev.txHash)
    } else {
      await runCase(label, 'Held',
        () => directPay(VAULT_MAIN, API_VENDOR, PER_CAP + 1n, `over-cap #${i}`),
        VAULT_MAIN)
    }
  }

  // ── GROUP 3: Daily cap (10 cases) — vaultDaily ────────────────────────────
  console.log('\n--- GROUP 3: Daily cap ---')
  for (let i = 1; i <= 5; i++) {
    const label = `3.${i} filling daily cap`
    const ev = dailyEvents.get(BigInt(i))
    if (ev) {
      recordExisting(label, 'Paid', ev.type, ev.txHash)
    } else {
      await runCase(label, 'Paid',
        () => directPay(VAULT_DAILY, API_VENDOR, PER_CAP, `daily fill #${i}`),
        VAULT_DAILY)
    }
  }
  for (let i = 6; i <= 10; i++) {
    const label = `3.${i} over daily cap`
    const ev = dailyEvents.get(BigInt(i))
    if (ev) {
      recordExisting(label, 'Held', ev.type, ev.txHash)
    } else {
      await runCase(label, 'Held',
        () => directPay(VAULT_DAILY, API_VENDOR, SMALL, `over daily #${i}`),
        VAULT_DAILY)
    }
  }

  // ── GROUP 4: Unknown payee (5 cases) — vaultMain ──────────────────────────
  console.log('\n--- GROUP 4: Unknown payee ---')
  for (let i = 1; i <= 5; i++) {
    const label = `4.${i} unknown payee`
    const ev = mainEvents.get(BigInt(15 + i))
    if (ev) {
      recordExisting(label, 'Held', ev.type, ev.txHash)
    } else {
      await runCase(label, 'Held',
        () => directPay(VAULT_MAIN, UNKNOWN1, SMALL, `unknown payee #${i}`),
        VAULT_MAIN)
    }
  }

  // ── GROUP 5: Burst (10 cases) — vaultMain ─────────────────────────────────
  // Reset rate buffer before group 5 via setPolicy
  console.log('\n--- GROUP 5: Burst over rate limit ---')
  if (!completedLabels.has('5.1 burst within rate limit') && !stopped) {
    await sleep(1500)
    const resetHash = await walletClient.writeContract({
      address: VAULT_MAIN, abi: LEASH_ABI, functionName: 'setPolicy',
      args: [account.address, PER_CAP, DAILY_MAIN, MAX_PER_HOUR],
    })
    await waitTx(resetHash)
    console.log('  (rate buffer reset via setPolicy)')
    await sleep(1500)
  }
  for (let i = 1; i <= 3; i++) {
    await runCase(`5.${i} burst within rate limit`, 'Paid',
      () => directPay(VAULT_MAIN, API_VENDOR, SMALL, `burst #${i}`), VAULT_MAIN)
  }
  for (let i = 4; i <= 10; i++) {
    await runCase(`5.${i} burst over rate limit`, 'Held',
      () => directPay(VAULT_MAIN, API_VENDOR, SMALL, `burst #${i}`), VAULT_MAIN)
  }

  // ── GROUP 6: Frozen vault (5 cases) — vaultMain ───────────────────────────
  console.log('\n--- GROUP 6: Frozen vault ---')
  if (!completedLabels.has('6.1 frozen vault blocks pay') && !stopped) {
    await sleep(1500)
    const h = await walletClient.writeContract({
      address: VAULT_MAIN, abi: LEASH_ABI, functionName: 'freeze', args: [],
    })
    await waitTx(h)
    console.log('  vault frozen')
    await sleep(1500)
  }
  for (let i = 1; i <= 5; i++) {
    await runCase(`6.${i} frozen vault blocks pay`, 'Blocked',
      () => directPay(VAULT_MAIN, API_VENDOR, SMALL, `pay while frozen #${i}`), VAULT_MAIN)
  }
  if (!stopped) {
    await sleep(1500)
    const h = await walletClient.writeContract({
      address: VAULT_MAIN, abi: LEASH_ABI, functionName: 'unfreeze', args: [],
    })
    await waitTx(h)
    console.log('  vault unfrozen')
    await sleep(1500)
  }

  // ── GROUP 7: Denylist hard block (5 cases) — vaultMain ────────────────────
  console.log('\n--- GROUP 7: Denylist hard block ---')
  if (!completedLabels.has('7.1 denylist hard block') && !stopped) {
    // Reset rate buffer so these don't get held for rate_limit instead of Blocked
    await sleep(1500)
    const resetHash = await walletClient.writeContract({
      address: VAULT_MAIN, abi: LEASH_ABI, functionName: 'setPolicy',
      args: [account.address, PER_CAP, DAILY_MAIN, MAX_PER_HOUR],
    })
    await waitTx(resetHash)
    console.log('  (rate buffer reset via setPolicy)')
    await sleep(1500)
  }
  for (let i = 1; i <= 5; i++) {
    await runCase(`7.${i} denylist hard block`, 'Blocked',
      () => directPay(VAULT_MAIN, BLOCKED1, SMALL, `pay denied payee #${i}`), VAULT_MAIN)
  }

  // ── Final state ───────────────────────────────────────────────────────────
  const finalMain  = await counters(VAULT_MAIN)
  const finalDaily = await counters(VAULT_DAILY)
  const frozenFinal = await publicClient.readContract({
    address: VAULT_MAIN, abi: LEASH_ABI, functionName: 'frozen',
  }) as boolean

  console.log()
  console.log('=== CORPUS SUMMARY ===')
  console.log(`  Paid    : ${totalPaid}`)
  console.log(`  Held    : ${totalHeld}`)
  console.log(`  Blocked : ${totalBlocked}`)
  console.log(`  Total   : ${totalPaid + totalHeld + totalBlocked}`)
  console.log(`  WRONG   : ${wrongCount}`)
  console.log()
  console.log('On-chain state (vaultMain):')
  console.log(`  paidAlone   : ${finalMain.pa}`)
  console.log(`  heldCount   : ${finalMain.hc}`)
  console.log(`  blockedCount: ${finalMain.bc}`)
  console.log(`  frozen      : ${frozenFinal}`)
  console.log('On-chain state (vaultDaily — group 3):')
  console.log(`  paidAlone   : ${finalDaily.pa}`)
  console.log(`  heldCount   : ${finalDaily.hc}`)
  console.log(`  blockedCount: ${finalDaily.bc}`)

  if (frozenFinal) {
    console.warn('WARNING: vaultMain still frozen — unfreezing')
    await waitTx(await walletClient.writeContract({
      address: VAULT_MAIN, abi: LEASH_ABI, functionName: 'unfreeze', args: [],
    }))
  }

  const balEnd = await walletBalance()
  console.log(`\nWallet balance at end: ${formatUnits(balEnd, 18)} USDC`)

  // Final save with up-to-date counters
  const out = {
    vaultMain:  VAULT_MAIN,
    vaultDaily: VAULT_DAILY,
    ranAt: new Date().toISOString(),
    totals: {
      paid: totalPaid, held: totalHeld, blocked: totalBlocked,
      total: totalPaid + totalHeld + totalBlocked, wrong: wrongCount,
    },
    onchain: {
      vaultMain: {
        paidAlone:    finalMain.pa.toString(),
        heldCount:    finalMain.hc.toString(),
        blockedCount: finalMain.bc.toString(),
        frozen: frozenFinal,
      },
      vaultDaily: {
        paidAlone:    finalDaily.pa.toString(),
        heldCount:    finalDaily.hc.toString(),
        blockedCount: finalDaily.bc.toString(),
      },
    },
    cases: results,
  }
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`\nResults written to corpus-results.json (${results.length} cases)`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
