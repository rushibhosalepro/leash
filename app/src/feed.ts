import { nativeToDisplay } from '@/leash-contract'
import { useVaultEvents, type VaultEvent } from '@/vaultEvents'
import { useAgentLog } from '@/useAgentLog'

export type Status = 'sent' | 'waiting' | 'approved' | 'denied' | 'blocked' | 'failed' | 'deposit' | 'withdrawal'

/** One line in the wallet feed: an agent payment, a deposit or withdrawal, or a failed attempt from the agent log. */
export interface Tx {
  key: string
  status: Status
  amount: number                 // USDC
  counterparty?: `0x${string}`
  name?: string
  reason?: string
  rule?: string
  error?: string
  tx?: string
  time: number                   // ms
  paymentId?: bigint             // for owner actions on held payments
  notes?: { note: string }[]
  example?: boolean
}

export const isHeld = (s: Status) => s === 'waiting' || s === 'approved' || s === 'denied'
export const isOut = (s: Status) => s === 'sent' || s === 'approved' || s === 'withdrawal'

const toUsd = (v: bigint) => Number(nativeToDisplay(v))
const exampleAddr = (head: string, tail: string) => `0x${head}${'0'.repeat(36 - head.length)}${tail}` as `0x${string}`
const minutesAgo = (m: number) => Date.now() - m * 60_000

// The design's scenarios, shown only while the vault has no real activity yet.
export const EXAMPLES: Tx[] = ([
  { status: 'waiting', name: 'Weather API', counterparty: exampleAddr('9a1c', '44b2'), amount: 0.2, reason: 'Getting the hourly forecast for the trip', rule: 'allowlist', time: minutesAgo(4) },
  { status: 'sent', name: 'Search API', counterparty: exampleAddr('2be7', '8c55'), amount: 0.05, reason: 'Looking up flight times the user asked for', time: minutesAgo(20) },
  { status: 'sent', name: 'AI model API', counterparty: exampleAddr('3c4d', 'a210'), amount: 0.2, reason: 'Summarising a 40-page PDF for the user', time: minutesAgo(35) },
  { status: 'blocked', name: 'Data reseller', counterparty: exampleAddr('dead', 'beef'), amount: 0.5, reason: 'Buying a premium data export a website offered', rule: 'denylist', time: minutesAgo(80) },
  { status: 'deposit', amount: 10, reason: 'Into the vault', time: minutesAgo(27 * 60) },
] satisfies Omit<Tx, 'key'>[]).map((t, i) => ({ ...t, key: `ex-${i}`, example: true }))

/** Every vault event as a feed line, with real times from the blocks. */
function useChainFeed() {
  const { data: events, isLoading, isError } = useVaultEvents()
  if (!events) return { data: undefined, isLoading, isError }
  const of = (name: string) => events.filter(e => e.name === name)
  const [paid, held, blocked, approved, denied, deposited, withdrawn] =
    ['Paid', 'Held', 'Blocked', 'Approved', 'Denied', 'Deposited', 'Withdrawn'].map(of)
  const approvedIds = new Set(approved.map(e => e.args.id)), deniedIds = new Set(denied.map(e => e.args.id))

  type PaymentArgs = { id: bigint; payee: `0x${string}`; amount: bigint; reason?: string; ruleBroken?: string }
  const payment = (kind: 'paid' | 'held' | 'blocked') => (e: VaultEvent): Tx => {
    const a = e.args as PaymentArgs
    const status: Status = kind === 'paid' ? 'sent' : kind === 'blocked' ? 'blocked'
      : approvedIds.has(a.id) ? 'approved' : deniedIds.has(a.id) ? 'denied' : 'waiting'
    return {
      key: `${kind}-${a.id}`, status, amount: toUsd(a.amount), counterparty: a.payee,
      reason: e.memo || a.reason || '', rule: a.ruleBroken, tx: e.tx, time: e.time ?? 0, paymentId: a.id,
    }
  }
  const transfer = (status: 'deposit' | 'withdrawal') => (e: VaultEvent, i: number): Tx => ({
    key: `${status}-${e.tx}-${i}`, status, amount: toUsd((e.args.amount as bigint | undefined) ?? 0n),
    reason: status === 'deposit' ? 'Into the vault' : 'Out to the owner', tx: e.tx, time: e.time ?? 0,
  })

  const data: Tx[] = [
    ...paid.map(payment('paid')), ...held.map(payment('held')), ...blocked.map(payment('blocked')),
    ...deposited.map(transfer('deposit')), ...withdrawn.map(transfer('withdrawal')),
  ]
  return { data, isLoading, isError }
}

/**
 * The whole feed, newest first: on-chain events, plus attempts that never produced an event (from the local agent log),
 * with the agent's notes attached. Falls back to labelled examples while the vault has no activity at all.
 */
export function useFeed() {
  const { data: chain, isLoading, isError } = useChainFeed()
  const { notesFor, failed } = useAgentLog()
  const failedTx: Tx[] = failed.map(a => ({
    key: `failed-${a.id}`, status: 'failed', amount: Number(a.amount_usdc), counterparty: a.payee, name: a.payee_name ?? undefined,
    reason: a.reason, error: a.error ?? undefined, tx: a.tx_hash ?? undefined, time: Date.parse(a.created_at), notes: a.notes,
  }))
  const real = [...(chain ?? []).map(t => ({ ...t, notes: t.tx ? notesFor(t.tx) : [] })), ...failedTx].sort((a, b) => b.time - a.time)
  const isExample = !!chain && real.length === 0
  return { feed: isExample ? EXAMPLES : real, isExample, isLoading, isError }
}

export function dayLabel(ms: number) {
  const d = new Date(ms), today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export const isToday = (ms: number) => new Date(ms).toDateString() === new Date().toDateString()
