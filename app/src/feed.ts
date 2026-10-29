import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { hexToString } from 'viem'
import { LEASH_EVENTS, MEMO_ADDRESS, MEMO_EVENT, nativeToDisplay } from '@/leash-contract'
import { useNetwork } from '@/network'
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

/** A block's timestamp never changes, so fetch each one once per page load. */
const blockTimes = new Map<bigint, number>()

/** Every vault event as a feed line, with real times from the blocks. Two RPC calls per refresh. */
function useChainFeed() {
  const { network } = useNetwork()
  const client = usePublicClient({ chainId: network.chain.id })
  const vault = network.vault

  return useQuery({
    queryKey: ['feed', network.id, vault],
    enabled: !!vault && !!client,
    // The public Arc RPCs rate-limit, so refresh every 15s and never refetch a block time.
    refetchInterval: 15000,
    queryFn: async (): Promise<Tx[]> => {
      const fromBlock = network.fromBlock
      const [logs, memos] = await Promise.all([
        client!.getContractEvents({ address: vault!, abi: LEASH_EVENTS, fromBlock, toBlock: 'latest' }),
        client!.getContractEvents({ address: MEMO_ADDRESS, abi: MEMO_EVENT, eventName: 'Memo', args: { target: vault! }, fromBlock, toBlock: 'latest' }),
      ])
      const of = <N extends string>(name: N) => logs.filter(l => l.eventName === name) as unknown as
        { args: { id?: bigint; amount?: bigint } & Record<string, unknown>; transactionHash: `0x${string}`; blockNumber: bigint }[]
      const [paid, held, blocked, approved, denied, deposited, withdrawn] =
        (['Paid', 'Held', 'Blocked', 'Approved', 'Denied', 'Deposited', 'Withdrawn'] as const).map(of)

      const blocks = [...new Set([...paid, ...held, ...blocked, ...deposited, ...withdrawn].map(l => l.blockNumber))]
      await Promise.all(blocks.filter(b => !blockTimes.has(b)).map(async b => {
        blockTimes.set(b, Number((await client!.getBlock({ blockNumber: b })).timestamp) * 1000)
      }))
      const memoByTx = new Map(memos.map(m => [m.transactionHash, hexToString(m.args.memo ?? '0x')]))
      const approvedIds = new Set(approved.map(e => e.args.id)), deniedIds = new Set(denied.map(e => e.args.id))

      type PaymentArgs = { id: bigint; payee: `0x${string}`; amount: bigint; reason?: string; ruleBroken?: string }
      const payment = (kind: 'paid' | 'held' | 'blocked') => (e: { args: unknown; transactionHash: `0x${string}`; blockNumber: bigint }): Tx => {
        const a = e.args as PaymentArgs
        const status: Status = kind === 'paid' ? 'sent' : kind === 'blocked' ? 'blocked'
          : approvedIds.has(a.id) ? 'approved' : deniedIds.has(a.id) ? 'denied' : 'waiting'
        return {
          key: `${kind}-${a.id}`, status, amount: toUsd(a.amount), counterparty: a.payee,
          reason: memoByTx.get(e.transactionHash) || a.reason || '', rule: a.ruleBroken,
          tx: e.transactionHash, time: blockTimes.get(e.blockNumber) ?? 0, paymentId: a.id,
        }
      }
      const transfer = (status: 'deposit' | 'withdrawal') => (e: { args: { amount?: bigint }; transactionHash: `0x${string}`; blockNumber: bigint }, i: number): Tx => ({
        key: `${status}-${e.transactionHash}-${i}`, status, amount: toUsd(e.args.amount ?? 0n),
        reason: status === 'deposit' ? 'Into the vault' : 'Out to the owner', tx: e.transactionHash, time: blockTimes.get(e.blockNumber) ?? 0,
      })

      return [
        ...paid.map(payment('paid')), ...held.map(payment('held')), ...blocked.map(payment('blocked')),
        ...deposited.map(transfer('deposit')), ...withdrawn.map(transfer('withdrawal')),
      ]
    },
  })
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
