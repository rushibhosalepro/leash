import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { hexToString } from 'viem'
import { ArrowUpRight, ArrowDownLeft, Clock, Ban, AlertCircle, ExternalLink, type LucideIcon } from 'lucide-react'
import { LEASH_EVENTS, MEMO_ADDRESS, MEMO_EVENT, nativeToDisplay, ruleInWords, shortAddr } from '@/leash-contract'
import { useNetwork, txUrl } from '@/network'
import { useVault, useVaultWrite } from '@/useVault'
import { usePayees } from '@/usePayees'
import { useAgentLog } from '@/useAgentLog'
import { Balance } from './Balance'
import { Payees } from './Payees'

type Status = 'sent' | 'waiting' | 'approved' | 'denied' | 'blocked' | 'failed' | 'deposit' | 'withdrawal'

/** One line in the wallet-style feed: an agent payment, a deposit or withdrawal, or a failed attempt. */
interface Tx {
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
  example?: boolean
}

const STATUS: Record<Status, { icon: LucideIcon; label: string; color: string; bg: string; sign: '-' | '+' | ''; struck?: boolean }> = {
  sent: { icon: ArrowUpRight, label: 'Sent by agent', color: 'var(--paid)', bg: 'var(--paid-bg)', sign: '-' },
  approved: { icon: ArrowUpRight, label: 'Approved by you · sent', color: 'var(--paid)', bg: 'var(--paid-bg)', sign: '-' },
  waiting: { icon: Clock, label: 'Waiting for you', color: 'var(--held)', bg: 'var(--held-bg)', sign: '' },
  denied: { icon: Ban, label: 'Denied by you', color: 'var(--subtle)', bg: 'var(--surface-strong)', sign: '', struck: true },
  blocked: { icon: Ban, label: 'Blocked', color: 'var(--blocked)', bg: 'var(--blocked-bg)', sign: '', struck: true },
  failed: { icon: AlertCircle, label: 'Failed', color: 'var(--subtle)', bg: 'var(--surface-strong)', sign: '', struck: true },
  deposit: { icon: ArrowDownLeft, label: 'Deposit', color: 'var(--paid)', bg: 'var(--paid-bg)', sign: '+' },
  withdrawal: { icon: ArrowUpRight, label: 'Withdrawn to you', color: 'var(--ink-2)', bg: 'var(--surface-strong)', sign: '-' },
}

const usd = (n: number) => `$${n.toFixed(2)}`
const toUsd = (v: bigint) => Number(nativeToDisplay(v))
const exampleAddr = (head: string, tail: string) => `0x${head}${'0'.repeat(36 - head.length)}${tail}` as `0x${string}`
const minutesAgo = (m: number) => Date.now() - m * 60_000

// The design's scenarios, shown only while the vault has no real activity yet.
const EXAMPLES: Tx[] = ([
  { status: 'sent', name: 'Weather API', counterparty: exampleAddr('9a1c', '44b2'), amount: 0.02, reason: 'Checking tomorrow’s forecast for the user', time: minutesAgo(4) },
  { status: 'waiting', name: 'Conference tickets', counterparty: exampleAddr('7f3e', 'c19a'), amount: 40, reason: 'Booking the conference ticket from the user’s email', rule: 'per_payment_cap', time: minutesAgo(12) },
  { status: 'sent', name: 'AI model API', counterparty: exampleAddr('3c4d', 'a210'), amount: 0.2, reason: 'Summarising a 40-page PDF for the user', time: minutesAgo(35) },
  { status: 'blocked', name: 'Data reseller', counterparty: exampleAddr('dead', 'beef'), amount: 0.5, reason: 'Buying a premium data export a website offered', rule: 'denylist', time: minutesAgo(80) },
  { status: 'approved', name: 'Translation service', counterparty: exampleAddr('51aa', '9e83'), amount: 2.4, reason: 'Translating the supplier contract into Spanish', rule: 'allowlist', time: minutesAgo(26 * 60) },
  { status: 'deposit', amount: 10, reason: 'From your wallet', time: minutesAgo(27 * 60) },
] satisfies Omit<Tx, 'key'>[]).map((t, i) => ({ ...t, key: `ex-${i}`, example: true }))

/** Every vault event as a feed line, with real times from the blocks. */
/** A block's timestamp never changes, so fetch each one once per page load. */
const blockTimes = new Map<bigint, number>()

function useVaultFeed() {
  const { network } = useNetwork()
  const client = usePublicClient({ chainId: network.chain.id })
  const vault = network.vault

  return useQuery({
    queryKey: ['feed', network.id, vault],
    enabled: !!vault && !!client,
    // The public Arc RPCs rate-limit: two calls per refresh, every 15s, and block times are cached forever.
    refetchInterval: 15000,
    queryFn: async (): Promise<Tx[]> => {
      const fromBlock = network.fromBlock
      const [logs, memos] = await Promise.all([
        client!.getContractEvents({ address: vault!, abi: LEASH_EVENTS, fromBlock }),
        client!.getContractEvents({ address: MEMO_ADDRESS, abi: MEMO_EVENT, eventName: 'Memo', args: { target: vault! }, fromBlock }),
      ])
      const of = <N extends string>(name: N) => logs.filter(l => l.eventName === name) as unknown as
        { args: { id?: bigint; amount?: bigint } & Record<string, unknown>; transactionHash: `0x${string}`; blockNumber: bigint }[]
      const [paid, held, blocked, approved, denied, deposited, withdrawn] =
        (['Paid', 'Held', 'Blocked', 'Approved', 'Denied', 'Deposited', 'Withdrawn'] as const).map(of)

      const blocks = [...new Set([...paid, ...held, ...blocked, ...deposited, ...withdrawn].map(l => l.blockNumber))]
      await Promise.all(blocks.filter(b => !blockTimes.has(b)).map(async b => {
        blockTimes.set(b, Number((await client!.getBlock({ blockNumber: b })).timestamp) * 1000)
      }))
      const stamps = blockTimes
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
          tx: e.transactionHash, time: stamps.get(e.blockNumber) ?? 0, paymentId: a.id,
        }
      }
      const transfer = (status: 'deposit' | 'withdrawal') => (e: { args: { amount?: bigint }; transactionHash: `0x${string}`; blockNumber: bigint }, i: number): Tx => ({
        key: `${status}-${e.transactionHash}-${i}`, status, amount: toUsd(e.args.amount ?? 0n),
        reason: status === 'deposit' ? 'Into the vault' : 'Out to the owner', tx: e.transactionHash, time: stamps.get(e.blockNumber) ?? 0,
      })

      return [
        ...paid.map(payment('paid')), ...held.map(payment('held')), ...blocked.map(payment('blocked')),
        ...deposited.map(transfer('deposit')), ...withdrawn.map(transfer('withdrawal')),
      ]
    },
  })
}

function dayLabel(ms: number) {
  const d = new Date(ms), today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function HeldActions({ paymentId }: { paymentId: bigint }) {
  const { write, busy } = useVaultWrite()
  const [trust, setTrust] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <button disabled={busy} onClick={() => write('approve', [paymentId, trust, 0n])}
        className="px-3 py-1 rounded-md text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
        Approve
      </button>
      <button disabled={busy} onClick={() => write('deny', [paymentId])}
        className="px-3 py-1 rounded-md text-xs disabled:opacity-50" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
        Deny
      </button>
      <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
        <input type="checkbox" checked={trust} onChange={e => setTrust(e.target.checked)} />
        add to payees
      </label>
    </div>
  )
}

function TxRow({ t, name, notes, isOwner }: { t: Tx; name?: string | null; notes: { note: string }[]; isOwner: boolean }) {
  const { network } = useNetwork()
  const s = STATUS[t.status]
  const Icon = s.icon
  const title = t.status === 'deposit' ? 'Deposit' : t.status === 'withdrawal' ? 'Withdrawal'
    : name ?? (t.counterparty ? shortAddr(t.counterparty) : 'Unknown')
  const why = t.error ?? (t.rule ? ruleInWords(t.rule) : '')

  return (
    <div className="flex gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: s.bg, color: s.color }}>
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {title}
            {name && t.counterparty && <span className="ml-2 text-xs font-normal mono" style={{ color: 'var(--subtle)' }}>{shortAddr(t.counterparty)}</span>}
          </div>
          <div className="text-sm font-semibold tabular-nums whitespace-nowrap"
            style={{ color: t.status === 'deposit' ? 'var(--paid)' : s.struck ? 'var(--subtle)' : 'var(--ink)', textDecoration: s.struck ? 'line-through' : undefined }}>
            {s.sign === '-' ? '−' : s.sign}{usd(t.amount)}
          </div>
        </div>
        <div className="flex items-baseline gap-3 mt-0.5">
          <div className="min-w-0 flex-1 text-xs truncate" style={{ color: 'var(--muted)' }}>{t.reason && `“${t.reason}”`}</div>
          <div className="text-[11px] font-medium whitespace-nowrap" style={{ color: s.color }}>{s.label}</div>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
          <span>{t.time ? new Date(t.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          {why && <span style={{ color: t.status === 'failed' || t.status === 'blocked' ? 'var(--blocked)' : 'var(--held)' }}>· {why}</span>}
          {t.example ? <span className="uppercase tracking-wider">· Example</span>
            : t.tx && (
              <a href={txUrl(network, t.tx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                · explorer <ExternalLink size={10} />
              </a>
            )}
        </div>
        {notes.length > 0 && (
          <div className="mt-1.5 space-y-0.5 pl-2.5" style={{ borderLeft: '2px solid var(--border-strong)' }}>
            {notes.map((n, i) => <div key={i} className="text-xs" style={{ color: 'var(--ink-2)' }}><span style={{ color: 'var(--subtle)' }}>Note · </span>{n.note}</div>)}
          </div>
        )}
        {t.status === 'waiting' && isOwner && !t.example && t.paymentId !== undefined && <HeldActions paymentId={t.paymentId} />}
      </div>
    </div>
  )
}

type Filter = 'all' | 'sent' | 'held' | 'blocked' | 'failed' | 'money'

const FILTERS: Record<Filter, { label: string; match: (s: Status) => boolean }> = {
  all: { label: 'All', match: () => true },
  sent: { label: 'Sent by agent', match: s => s === 'sent' || s === 'approved' },
  held: { label: 'Waited for you', match: s => s === 'waiting' || s === 'approved' || s === 'denied' },
  blocked: { label: 'Blocked', match: s => s === 'blocked' },
  failed: { label: 'Failed', match: s => s === 'failed' },
  money: { label: 'Deposits & withdrawals', match: s => s === 'deposit' || s === 'withdrawal' },
}

function StatTab({ label, value, color, active, onClick }: { label: string; value: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="text-left px-4 py-3 transition-colors"
      style={{
        borderRadius: 16, background: active ? 'var(--surface-strong)' : 'var(--surface)',
        border: `1px solid ${active ? color : 'var(--border)'}`,
      }}>
      <div className="text-2xl font-bold tabular-nums display" style={{ color }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: active ? 'var(--ink)' : 'var(--subtle)' }}>{label}</div>
    </button>
  )
}

export function Activity({ onOpenRules }: { onOpenRules?: () => void }) {
  const { isOwner, allowlistSize } = useVault()
  const { nameOf } = usePayees(allowlistSize)
  const { notesFor, failed } = useAgentLog()
  const { data: chain, isLoading, isError } = useVaultFeed()
  // After 8 seconds of a first load, say why instead of an endless "Loading…".
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!isLoading) return
    const timer = setTimeout(() => setSlow(true), 8000)
    return () => clearTimeout(timer)
  }, [isLoading])

  const failedTx: Tx[] = failed.map(a => ({
    key: `failed-${a.id}`, status: 'failed', amount: Number(a.amount_usdc), counterparty: a.payee, name: a.payee_name ?? undefined,
    reason: a.reason, error: a.error ?? undefined, tx: a.tx_hash ?? undefined, time: Date.parse(a.created_at),
  }))
  const real = [...(chain ?? []), ...failedTx].sort((a, b) => b.time - a.time)
  const feed = chain && real.length === 0 ? EXAMPLES : real
  const [filter, setFilter] = useState<Filter>('all')
  const count = (f: Filter) => feed.filter(t => FILTERS[f].match(t.status)).length
  const toggle = (f: Filter) => setFilter(cur => (cur === f ? 'all' : f))
  const shown = feed.filter(t => FILTERS[filter].match(t.status))
  const seen = (chain ?? []).flatMap(t => (t.counterparty ? [t.counterparty] : []))
  const days = shown.reduce<{ day: string; items: Tx[] }[]>((acc, t) => {
    const day = dayLabel(t.time)
    const last = acc[acc.length - 1]
    if (last?.day === day) last.items.push(t); else acc.push({ day, items: [t] })
    return acc
  }, [])
  const failedNotes = new Map(failed.map(a => [`failed-${a.id}`, a.notes]))

  return (
    <div className="space-y-6">
      <p className="display text-3xl sm:text-4xl leading-tight" style={{ color: 'var(--ink)' }}>
        Your AI agent pays on its own.<br /><span style={{ color: 'var(--subtle)' }}>Above the line, it asks.</span>
      </p>

      <Balance onOpenRules={onOpenRules} />
      <Payees seen={seen} />

      <div>
        <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--ink)' }}>Transactions</h2>
        <div className="grid grid-cols-3 gap-3">
          <StatTab label="Sent by agent" value={count('sent')} color="var(--paid)" active={filter === 'sent'} onClick={() => toggle('sent')} />
          <StatTab label="Waited for you" value={count('held')} color="var(--held)" active={filter === 'held'} onClick={() => toggle('held')} />
          <StatTab label="Blocked" value={count('blocked')} color="var(--blocked)" active={filter === 'blocked'} onClick={() => toggle('blocked')} />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {(['all', 'failed', 'money'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} className="px-3 py-1 text-xs font-medium"
              style={{ background: filter === f ? 'var(--accent)' : 'var(--surface)', color: filter === f ? 'var(--on-accent)' : 'var(--muted)', border: '1px solid var(--border)' }}>
              {FILTERS[f].label} <span className="tabular-nums opacity-70">{count(f)}</span>
            </button>
          ))}
          {filter !== 'all' && !['failed', 'money'].includes(filter) && (
            <span className="text-xs self-center" style={{ color: 'var(--subtle)' }}>Showing: {FILTERS[filter].label}. Click again to show all.</span>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="text-sm" style={{ color: 'var(--subtle)' }}>
          {slow ? 'Arc’s public RPC is slow or rate-limiting right now. Still trying…' : 'Loading transactions from Arc…'}
        </div>
      )}
      {isError && <div className="text-sm" style={{ color: 'var(--danger)' }}>Could not read transactions from Arc. Retrying…</div>}
      {feed === EXAMPLES && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--surface-strong)', border: '1px dashed var(--border-strong)', color: 'var(--muted)' }}>
          No transactions yet. These examples show what you will see once your agent pays. Connect it under “Connect your agent”.
        </div>
      )}

      {shown.length === 0 && feed.length > 0 && (
        <div className="text-sm px-1" style={{ color: 'var(--subtle)' }}>Nothing under “{FILTERS[filter].label}” yet.</div>
      )}
      {days.map(({ day, items }) => (
        <section key={day} className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)', background: 'var(--surface-strong)' }}>{day}</div>
          <div className="-mt-px">
            {items.map(t => (
              <TxRow key={t.key} t={t} isOwner={isOwner}
                name={t.name ?? (t.counterparty ? nameOf(t.counterparty) : null)}
                notes={t.status === 'failed' ? failedNotes.get(t.key) ?? [] : t.tx ? notesFor(t.tx) : []} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
