// Chain access for the Leash MCP server. The agent key only ever calls pay(); the contract decides
// whether a payment is paid, held for the owner, or blocked. Nothing here can raise a limit.
import { readFileSync } from 'node:fs'
import {
  createPublicClient, createWalletClient, http, fallback, encodeFunctionData, decodeEventLog,
  keccak256, toBytes, toHex, hexToString, parseUnits, formatUnits, type Abi, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { listPayees, nameOf } from './payees'
import { logAttempt, addNote, findAttempt, recentAttempts } from './db'
import { arc, arcTestnet } from 'viem/chains'

const artifactPath = new URL('../../app/contracts/out/Leash.sol/Leash.json', import.meta.url)
export const LEASH_ABI = JSON.parse(readFileSync(artifactPath, 'utf8')).abi as Abi

export const MEMO_ADDRESS = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as const
const MEMO_ABI = [{
  name: 'memo', type: 'function', stateMutability: 'nonpayable', outputs: [],
  inputs: [
    { name: 'target', type: 'address' }, { name: 'data', type: 'bytes' },
    { name: 'memoId', type: 'bytes32' }, { name: 'memoData', type: 'bytes' },
  ],
}] as const
const MEMO_EVENT = {
  type: 'event', name: 'Memo', inputs: [
    { name: 'sender', type: 'address', indexed: true }, { name: 'target', type: 'address', indexed: true },
    { name: 'callDataHash', type: 'bytes32', indexed: false }, { name: 'memoId', type: 'bytes32', indexed: true },
    { name: 'memo', type: 'bytes', indexed: false }, { name: 'memoIndex', type: 'uint256', indexed: false },
  ],
} as const

// Arc's native USDC (the gas token) uses 18 decimals.
const NATIVE_DECIMALS = 18
export const toNative = (usdc: string) => parseUnits(usdc, NATIVE_DECIMALS)
export const toUsdc = (native: bigint) => formatUnits(native, NATIVE_DECIMALS)

// LEASH_NETWORK=mainnet points the server at Arc mainnet; anything else is testnet.
export const ON_MAINNET = process.env.LEASH_NETWORK === 'mainnet'
const CHAIN = ON_MAINNET ? arc : arcTestnet
export const EXPLORER = ON_MAINNET ? 'https://explorer.arc.io' : 'https://testnet.arcscan.app'
const OUTCOMES = ['paid', 'held', 'blocked'] as const

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is missing from mcp/.env`)
  return v
}

export const VAULT = required(ON_MAINNET ? 'LEASH_MAINNET_ADDRESS' : 'LEASH_ADDRESS') as Hex
export const FROM_BLOCK = BigInt((ON_MAINNET ? process.env.LEASH_MAINNET_FROM_BLOCK : process.env.LEASH_FROM_BLOCK) ?? '0')
const account = privateKeyToAccount(required('AGENT_PRIVATE_KEY') as Hex)
export const AGENT = account.address

// The public Arc RPC rate-limits; fall through every endpoint viem lists.
const transport = fallback(CHAIN.rpcUrls.default.http.map(url => http(url, { retryCount: 3, retryDelay: 400 })))
const pub = createPublicClient({ chain: CHAIN, transport })
const wallet = createWalletClient({ chain: CHAIN, transport, account })

const read = <T>(functionName: string, args: unknown[] = []) =>
  pub.readContract({ address: VAULT, abi: LEASH_ABI, functionName, args }) as Promise<T>

/** The vault owner, read live: the only wallet allowed to see the agent link and change server settings. */
export const vaultOwner = () => read<Hex>('owner')

// The contract has no getter for the payee lists, so rebuild them from the update events and confirm
// each address against isAllowlisted / isDenylisted, which are the source of truth.
async function payeeList(eventName: 'AllowlistUpdated' | 'DenylistUpdated', isIn: 'isAllowlisted' | 'isDenylisted') {
  const logs = await vaultEvents(eventName)
  const seen = [...new Set(logs.map(l => (l.args as { payee: Hex }).payee))]
  const current = await Promise.all(seen.map(async p => ((await read<boolean>(isIn, [p])) ? p : null)))
  return current.filter((p): p is Hex => p !== null)
}

// Mirrors the contract's rolling one-hour window: only payments the agent made alone count, not owner approvals.
async function paymentsInLastHour() {
  const paid = await vaultEvents('Paid')
  const recent = paid.slice(-50)
  const now = BigInt(Math.floor(Date.now() / 1000))
  const stamps = await Promise.all(recent.map(l => pub.getBlock({ blockNumber: l.blockNumber }).then(b => b.timestamp)))
  return stamps.filter(t => now - t < 3600n).length
}

export async function getRules() {
  const [policy, frozen, balance, remaining, owner, agentGas, trusted, blocked, usedThisHour, pending] = await Promise.all([
    read<[Hex, bigint, bigint, bigint]>('policy'),
    read<boolean>('frozen'),
    read<bigint>('balance'),
    read<bigint>('remainingToday'),
    read<Hex>('owner'),
    pub.getBalance({ address: AGENT }),
    payeeList('AllowlistUpdated', 'isAllowlisted'),
    payeeList('DenylistUpdated', 'isDenylisted'),
    paymentsInLastHour(),
    read<unknown[]>('pendingRequests'),
  ])
  const [agent, perPaymentCap, dailyCap, maxPerHour] = policy
  return {
    network: CHAIN.name,
    vault: VAULT,
    owner,
    agent,
    this_server_is_the_agent: agent.toLowerCase() === AGENT.toLowerCase(),
    you_can_change_these_rules: false,
    frozen,
    per_payment_limit_usdc: toUsdc(perPaymentCap),
    daily_limit_usdc: toUsdc(dailyCap),
    left_today_usdc: toUsdc(remaining),
    max_payments_per_hour: Number(maxPerHour),
    payments_in_last_hour: usedThisHour,
    trusted_payees: trusted,
    trusted_payees_rule: trusted.length
      ? 'Payments to anyone NOT on this list are held for the owner.'
      : 'No trusted list is set, so any payee is allowed within the limits.',
    blocked_payees: blocked,
    waiting_for_owner: pending.length,
    vault_balance_usdc: toUsdc(balance),
    agent_gas_balance_usdc: toUsdc(agentGas),
    how_rules_apply: [
      'Two rules: a daily limit for everything you spend (daily_limit_usdc, left_today_usdc), and a per-payment limit for each saved payee (see leash_list_payees).',
      'Paid immediately: the payee is saved, the amount is within its per-payment limit, and within what is left today.',
      'Held for the owner: the payee is not saved, the amount is over its per-payment limit, or over what is left today.',
      'Blocked (nothing moves): the payee is blocked or the vault is frozen.',
    ],
  }
}

/** Saved names merged with on-chain status; addresses trusted or blocked on-chain but never named are listed too. */
export async function listPayeesWithStatus() {
  const [trusted, blocked, allowlistSize] = await Promise.all([
    payeeList('AllowlistUpdated', 'isAllowlisted'),
    payeeList('DenylistUpdated', 'isDenylisted'),
    read<bigint>('allowlistSize'),
  ])
  const lower = (a: string) => a.toLowerCase()
  const trustedSet = new Set(trusted.map(lower)), blockedSet = new Set(blocked.map(lower))
  const saved = listPayees()
  const unnamed = [...trusted, ...blocked].filter(a => !saved.some(p => lower(p.address) === lower(a)))
  // can_pay = on the owner's on-chain payee list (or no list exists yet); not_active = named but not on the list.
  const status = (a: string) =>
    blockedSet.has(lower(a)) ? 'blocked' : trustedSet.has(lower(a)) || allowlistSize === 0n ? 'can_pay' : 'not_active'
  const all = [
    ...saved.map(p => ({ name: p.name as string | null, address: p.address })),
    ...[...new Set(unnamed)].map(a => ({ name: null, address: a })),
  ]
  // payeeLimit -> [perPaymentCap, dailyCap, spentToday, remainingToday]; 0 means no extra limit.
  const limits = await Promise.all(all.map(p => read<[bigint, bigint, bigint, bigint]>('payeeLimit', [p.address])))
  return {
    note: allowlistSize === 0n
      ? 'The owner has not activated any payee yet, so you may pay anyone within the daily limit.'
      : 'You can pay these payees up to their per-payment limit, within the daily limit. Anyone else is held for the owner.',
    payees: all.map((p, i) => {
      const [perPaymentCap] = limits[i]
      return {
        ...p,
        status: status(p.address),
        limit_per_payment_usdc: perPaymentCap > 0n ? toUsdc(perPaymentCap) : null,
      }
    }),
  }
}

export async function checkPayee(payee: Hex) {
  const [trusted, blocked, allowlistSize] = await Promise.all([
    read<boolean>('isAllowlisted', [payee]),
    read<boolean>('isDenylisted', [payee]),
    read<bigint>('allowlistSize'),
  ])
  return {
    payee,
    trusted,
    blocked,
    meaning: blocked
      ? 'Every payment to this payee is blocked.'
      : trusted || allowlistSize === 0n
        ? 'Payments to this payee are allowed within your limits.'
        : 'This payee is not trusted yet: payments to it are held for the owner.',
  }
}

const RULE_WORDS: Record<string, string> = {
  per_payment_cap: 'over the vault’s per-payment limit',
  payee_per_payment_cap: 'over the per-payment limit the owner set for this payee',
  payee_daily_cap: 'over the daily limit the owner set for this payee',
  daily_cap: 'over what is left of your daily limit',
  allowlist: 'not one of the owner’s saved payees',
  rate_limit: 'too many payments in the last hour',
  frozen: 'the owner has frozen the vault',
  denylist: 'payee is on the blocked list',
  zero_payee: 'no payee address',
  zero_amount: 'amount is zero',
  insufficient_balance: 'the vault does not hold enough USDC',
}
export const ruleInWords = (rule: string | null | undefined) => (rule ? RULE_WORDS[rule] ?? rule : null)

export async function checkPayment(payee: Hex, amountUsdc: string) {
  const [outcome, rule] = await read<[number, string]>('check', [payee, toNative(amountUsdc)])
  // check() reports Paid + "insufficient_balance" when the rules pass but the vault is short; pay() would revert.
  if (rule === 'insufficient_balance') return { would_be: 'failed', rule, why: ruleInWords(rule) }
  return { would_be: OUTCOMES[outcome] ?? 'unknown', rule: rule || null, why: ruleInWords(rule) }
}

/** Pays, then logs the attempt (and an optional note) in the local agent log, including attempts that fail. */
export async function pay(payee: Hex, amountUsdc: string, reason: string, note?: string) {
  let result: Record<string, unknown>
  try {
    // The vault refuses to pay more than it holds by reverting, which leaves no event; say so plainly instead.
    const [, rule] = await read<[number, string]>('check', [payee, toNative(amountUsdc)])
    result = rule === 'insufficient_balance'
      ? { outcome: 'failed', error: 'The vault does not hold enough USDC. Ask the owner to deposit.', payee, payee_name: nameOf(payee), amount_usdc: amountUsdc }
      : await sendPayment(payee, amountUsdc, reason)
  } catch (err) {
    const e = err as { shortMessage?: string; message?: string }
    result = { outcome: 'failed', error: e.shortMessage ?? e.message ?? String(err), payee, payee_name: nameOf(payee), amount_usdc: amountUsdc }
  }
  const attemptId = logAttempt({
    vault: VAULT, payee, payee_name: nameOf(payee), amount_usdc: amountUsdc, reason, outcome: String(result.outcome),
    payment_id: (result.payment_id as string | undefined) ?? null, tx_hash: (result.tx as string | undefined) ?? null,
    error: (result.error as string | undefined) ?? null,
  })
  if (note) addNote(attemptId, note)
  return { ...result, log_id: `a${attemptId}`, note: note ?? null }
}

/** Adds a note to an earlier attempt, found by payment id, tx hash, or log id ("a12"). */
export function noteOnPayment(ref: string, note: string) {
  const attempt = findAttempt(VAULT, ref)
  if (!attempt) throw new Error(`No payment "${ref}" in the agent log. Use a payment_id, a tx hash, or a log_id from leash_pay.`)
  addNote(attempt.id, note)
  return { log_id: `a${attempt.id}`, payment_id: attempt.payment_id, outcome: attempt.outcome, added_note: note }
}

async function sendPayment(payee: Hex, amountUsdc: string, reason: string): Promise<Record<string, unknown>> {
  const data = encodeFunctionData({ abi: LEASH_ABI, functionName: 'pay', args: [payee, toNative(amountUsdc), reason] })
  const memoId = keccak256(toBytes(`${AGENT}:${Date.now()}:${reason}`))
  // Routed through Arc's Memo contract so the agent's reason is recorded on-chain with the call.
  const hash = await wallet.writeContract({
    address: MEMO_ADDRESS, abi: MEMO_ABI, functionName: 'memo',
    args: [VAULT, data, memoId, toHex(new TextEncoder().encode(reason))],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') return { outcome: 'failed', error: 'The transaction reverted on-chain.', tx: hash, explorer: `${EXPLORER}/tx/${hash}` }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== VAULT.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: LEASH_ABI, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> }
      if (ev.eventName === 'Paid' || ev.eventName === 'Held' || ev.eventName === 'Blocked') {
        return {
          outcome: ev.eventName.toLowerCase(),
          payment_id: String(ev.args.id),
          rule: (ev.args.ruleBroken as string | undefined) || null,
          why: ruleInWords(ev.args.ruleBroken as string | undefined),
          amount_usdc: amountUsdc,
          payee,
          payee_name: nameOf(payee),
          tx: hash,
          explorer: `${EXPLORER}/tx/${hash}`,
        }
      }
    } catch { /* not a Leash event */ }
  }
  return { outcome: 'unknown', tx: hash, explorer: `${EXPLORER}/tx/${hash}` }
}

async function vaultEvents(eventName: string, args?: Record<string, unknown>) {
  return pub.getContractEvents({ address: VAULT, abi: LEASH_ABI, eventName, args, fromBlock: FROM_BLOCK, toBlock: 'latest' })
}

export async function paymentStatus(id: string) {
  const paymentId = BigInt(id)
  const [paid, approved, denied, blocked, held] = await Promise.all(
    ['Paid', 'Approved', 'Denied', 'Blocked', 'Held'].map(e => vaultEvents(e, { id: paymentId })),
  )
  const hit = (logs: typeof paid) => logs[0] ? `${EXPLORER}/tx/${logs[0].transactionHash}` : null
  if (paid.length) return { payment_id: id, status: 'paid', explorer: hit(paid) }
  if (approved.length) return { payment_id: id, status: 'approved_by_owner_and_paid', explorer: hit(approved) }
  if (denied.length) return { payment_id: id, status: 'denied_by_owner', explorer: hit(denied) }
  if (blocked.length) return { payment_id: id, status: 'blocked', explorer: hit(blocked) }
  if (held.length) return { payment_id: id, status: 'waiting_for_owner', explorer: hit(held) }
  return { payment_id: id, status: 'not_found' }
}

export async function pendingForOwner() {
  const reqs = await read<{ id: bigint; payee: Hex; amount: bigint; reason: string; ruleBroken: string }[]>('pendingRequests')
  return reqs.map(r => ({ payment_id: String(r.id), payee: r.payee, payee_name: nameOf(r.payee), amount_usdc: toUsdc(r.amount), reason: r.reason, held_because: ruleInWords(r.ruleBroken) }))
}

export async function recentSpending(limit: number) {
  const [paid, held, blocked, memos, remaining] = await Promise.all([
    vaultEvents('Paid'), vaultEvents('Held'), vaultEvents('Blocked'),
    pub.getContractEvents({ address: MEMO_ADDRESS, abi: [MEMO_EVENT], eventName: 'Memo', args: { target: VAULT }, fromBlock: FROM_BLOCK, toBlock: 'latest' }),
    read<bigint>('remainingToday'),
  ])
  const memoByTx = new Map(memos.map(m => [m.transactionHash, hexToString((m.args as { memo: Hex }).memo)]))
  const log = recentAttempts(VAULT)
  const notesByTx = new Map(log.filter(a => a.tx_hash).map(a => [a.tx_hash!.toLowerCase(), a.notes.map(n => n.note)]))
  const failed = log.filter(a => a.outcome === 'failed').slice(0, limit).map(a => ({
    log_id: `a${a.id}`, outcome: 'failed', payee: a.payee, payee_name: a.payee_name, amount_usdc: a.amount_usdc,
    reason: a.reason, error: a.error, at: a.created_at, notes: a.notes.map(n => n.note),
    explorer: a.tx_hash ? `${EXPLORER}/tx/${a.tx_hash}` : null,
  }))
  const rows = [...paid.map(l => ['paid', l] as const), ...held.map(l => ['held', l] as const), ...blocked.map(l => ['blocked', l] as const)]
    .sort((a, b) => Number(b[1].blockNumber - a[1].blockNumber))
    .slice(0, limit)
    .map(([outcome, l]) => {
      const a = l.args as { id: bigint; payee: Hex; amount: bigint; reason: string; ruleBroken?: string }
      return {
        payment_id: String(a.id), outcome, payee: a.payee, payee_name: nameOf(a.payee), amount_usdc: toUsdc(a.amount),
        reason: memoByTx.get(l.transactionHash) ?? a.reason, rule: a.ruleBroken || null, why: ruleInWords(a.ruleBroken),
        notes: notesByTx.get(l.transactionHash.toLowerCase()) ?? [],
        explorer: `${EXPLORER}/tx/${l.transactionHash}`,
      }
    })
  return { left_today_usdc: toUsdc(remaining), recent: rows, failed_attempts: failed }
}
