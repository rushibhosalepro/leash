import { useState } from 'react'
import { useAccount, useBalance } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Plus, ArrowUp, Snowflake, Link2, Pause, ExternalLink } from 'lucide-react'
import { displayToNative, nativeToDisplay, ruleInWords, shortAddr } from '@/leash-contract'
import { useNetwork, addressUrl } from '@/network'
import { useVault, useVaultWrite } from '@/useVault'
import { usePayees } from '@/usePayees'
import { useAgentLink, timeAgo } from '@/useAgentLink'
import { useAgentLog } from '@/useAgentLog'
import { useFeed, isHeld, isToday, type Tx } from '@/feed'
import { TxList } from './TxList'
import { Payees } from './Payees'

const money = (v: bigint | undefined, dp = 2) => (v === undefined ? '—' : Number(nativeToDisplay(v)).toFixed(dp))
const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20 } as const

type Filter = 'all' | 'sent' | 'held' | 'blocked'
const matches = (f: Filter, t: Tx) =>
  f === 'all' || (f === 'sent' && t.status === 'sent') || (f === 'held' && isHeld(t.status)) || (f === 'blocked' && t.status === 'blocked')

/** The vault as a card: what it holds, today's allowance, and the agent's own separate wallet. */
function AgentCard() {
  const { network } = useNetwork()
  const { balance, remainingToday, policy, frozen } = useVault()
  // The agent signs from its own wallet, which only holds a little USDC for network fees.
  const { data: agentGas } = useBalance({ address: policy?.agent, chainId: network.chain.id, query: { enabled: !!policy, refetchInterval: 15_000 } })
  const [copied, setCopied] = useState(false)
  const copyAgent = () => { if (!policy) return; void navigator.clipboard.writeText(policy.agent); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const { online, info } = useAgentLink()
  const { lastUsedAt } = useAgentLog()
  const daily = policy?.dailyCap ?? 0n
  const left = remainingToday ?? 0n
  const pct = daily > 0n ? Number((left * 100n) / daily) : 0
  const connection = !online ? 'agent server offline' : info?.on === false ? 'agent link turned off'
    : lastUsedAt ? `connected by link · used ${timeAgo(lastUsedAt)}` : 'link ready · not used yet'

  return (
    <div className="relative overflow-hidden p-5 flex flex-col justify-between min-h-[230px]"
      style={{ ...card, background: 'linear-gradient(145deg, #1f2024 0%, #141518 100%)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--subtle)' }}>Agent spending vault</div>
          <div className="text-sm font-semibold mt-0.5" style={{ color: 'var(--ink)' }}>Your AI agent · {connection}</div>
        </div>
        <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full"
          style={{ background: frozen ? 'var(--blocked-bg)' : 'var(--paid-bg)', color: frozen ? 'var(--blocked)' : 'var(--paid)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />{frozen ? 'Frozen' : 'Running'}
        </span>
      </div>

      <div className="mt-6">
        <div className="text-xs" style={{ color: 'var(--subtle)' }}>In the vault · the agent can spend only from here, inside your rules</div>
        <div className="display text-5xl tabular-nums leading-none mt-1" style={{ color: 'var(--ink)' }}>
          {money(balance)} <span className="text-lg font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--subtle)' }}>
          <span>Can spend today</span>
          <span><b className="tabular-nums" style={{ color: 'var(--ink)' }}>${money(left)}</b> of ${money(daily)}</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-strong)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--ink)' }} />
        </div>
        {policy && (
          <div className="mt-4 px-3 py-2.5 text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 12 }}>
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--subtle)' }}>Agent’s own wallet · a separate address that signs payments</span>
              <span className="tabular-nums shrink-0" style={{ color: 'var(--ink-2)' }} title="Kept only for network fees">
                {agentGas ? Number(agentGas.formatted).toFixed(2) : '—'} USDC for fees
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <a href={addressUrl(network, policy.agent)} target="_blank" rel="noopener noreferrer" className="mono break-all underline-offset-2 hover:underline" style={{ color: 'var(--ink)' }}>
                {policy.agent}
              </a>
              <button onClick={copyAgent} className="tile shrink-0 px-2 py-0.5 text-[11px]" style={{ border: '1px solid var(--border)', borderRadius: 8, color: 'var(--muted)' }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        {network.vault && (
          <div className="mt-2 text-[11px] mono text-right" style={{ color: 'var(--subtle)' }}>
            <a href={addressUrl(network, network.vault)} target="_blank" rel="noopener noreferrer">Vault {shortAddr(network.vault)}</a>
          </div>
        )}
      </div>
    </div>
  )
}

function TodayTiles({ feed, filter, setFilter }: { feed: Tx[]; filter: Filter; setFilter: (f: Filter) => void }) {
  const today = feed.filter(t => t.example || isToday(t.time))
  const tiles: { f: Filter; n: number; title: string; sub: string; color: string; bg: string }[] = [
    { f: 'sent', n: today.filter(t => t.status === 'sent').length, title: 'Paid alone', sub: 'inside your rules', color: 'var(--paid)', bg: 'var(--paid-bg)' },
    { f: 'held', n: today.filter(t => isHeld(t.status)).length, title: 'Held for you', sub: 'needs your yes', color: 'var(--held)', bg: 'var(--held-bg)' },
    { f: 'blocked', n: today.filter(t => t.status === 'blocked').length, title: 'Blocked', sub: 'no money moved', color: 'var(--blocked)', bg: 'var(--blocked-bg)' },
  ]
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>Today the agent tried</div>
      {tiles.map(t => (
        <button key={t.f} onClick={() => setFilter(filter === t.f ? 'all' : t.f)} aria-pressed={filter === t.f}
          className="tile flex items-center gap-3 px-4 py-3 text-left"
          style={{ background: t.bg, border: `1px solid ${filter === t.f ? t.color : 'transparent'}`, borderRadius: 14 }}>
          <span className="display text-2xl tabular-nums" style={{ color: t.color }}>{t.n}</span>
          <span>
            <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>{t.title}</span>
            <span className="block text-xs" style={{ color: 'var(--muted)' }}>{t.sub}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** Add funds / Withdraw open an amount row; Freeze toggles; Agent link jumps to the connect panel. */
function ActionTiles() {
  const { isOwner, frozen } = useVault()
  const { write, busy } = useVaultWrite()
  const { network } = useNetwork()
  const { address } = useAccount()
  const { data: wallet } = useBalance({ address, chainId: network.chain.id, query: { enabled: !!address } })
  const [open, setOpen] = useState<null | 'deposit' | 'withdraw'>(null)
  const [amount, setAmount] = useState('')
  const value = (() => { try { return amount ? displayToNative(amount) : 0n } catch { return 0n } })()

  const tile = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button onClick={onClick} className="tile flex flex-col items-center gap-2 py-4" style={{ ...card, borderRadius: 18 }}>
      <span className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ background: danger ? 'var(--blocked-bg)' : label === 'Add funds' ? 'var(--ink)' : 'var(--surface-strong)', color: danger ? 'var(--blocked)' : label === 'Add funds' ? 'var(--bg)' : 'var(--ink)' }}>
        {icon}
      </span>
      <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{label}</span>
    </button>
  )
  const submit = async () => {
    await (open === 'deposit' ? write('deposit', [], value) : write('withdraw', [value]))
    setAmount(''); setOpen(null)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        {tile(<Plus size={18} />, 'Add funds', () => setOpen(open === 'deposit' ? null : 'deposit'))}
        {tile(<ArrowUp size={18} />, 'Withdraw', () => setOpen(open === 'withdraw' ? null : 'withdraw'))}
        {tile(<Snowflake size={18} />, frozen ? 'Unfreeze' : 'Freeze', () => isOwner && void write(frozen ? 'unfreeze' : 'freeze'), !frozen)}
        {tile(<Link2 size={18} />, 'Agent link', () => document.getElementById('connect-agent')?.scrollIntoView({ behavior: 'smooth' }))}
      </div>
      {open && (isOwner ? (
        <div className="flex flex-wrap items-center gap-2 p-3" style={{ ...card, borderRadius: 16 }}>
          <div className="flex-1 min-w-[160px] flex items-center px-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12 }}>
            <span style={{ color: 'var(--subtle)' }}>$</span>
            <input autoFocus value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal"
              className="flex-1 bg-transparent px-2 py-2 text-sm outline-none tabular-nums" style={{ color: 'var(--ink)' }} />
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
          <button disabled={busy || value === 0n} onClick={submit} className="px-5 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{open === 'deposit' ? 'Add funds' : 'Withdraw'}</button>
          <div className="w-full text-xs" style={{ color: 'var(--subtle)' }}>
            {open === 'deposit' ? `From your wallet (${wallet ? Number(wallet.formatted).toFixed(2) : '—'} USDC) into the vault.` : 'From the vault back to your wallet. Only you can do this.'}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 p-3 text-sm" style={{ ...card, borderRadius: 16, color: 'var(--muted)' }}>
          Only the vault owner can {open === 'deposit' ? 'add funds' : 'withdraw'}.
          {!address && <ConnectKitButton label="Connect owner wallet" />}
        </div>
      ))}
    </div>
  )
}

/** Held payments waiting for the owner, as asks. */
function AskingCards({ feed, nameOf }: { feed: Tx[]; nameOf: (a: string) => string | null }) {
  const { isOwner } = useVault()
  const { write, busy } = useVaultWrite()
  const waiting = feed.filter(t => t.status === 'waiting')
  if (!waiting.length) return null
  return (
    <div className="space-y-2">
      {waiting.map(t => {
        const name = t.name ?? (t.counterparty ? nameOf(t.counterparty) ?? shortAddr(t.counterparty) : 'someone')
        return (
          <div key={t.key} className="flex flex-wrap items-center gap-4 p-4" style={{ ...card, borderColor: 'var(--held-border)' }}>
            <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--held-bg)', color: 'var(--held)' }}><Pause size={16} /></span>
            <div className="flex-1 min-w-[200px]">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--held)' }}>
                Your agent is asking{t.example && ' · example'}
              </div>
              <div className="text-base font-bold" style={{ color: 'var(--ink)' }}>Pay ${t.amount.toFixed(2)} to {name}?</div>
              {t.reason && <div className="text-xs" style={{ color: 'var(--muted)' }}>“{t.reason}”</div>}
              {t.rule && <div className="text-xs" style={{ color: 'var(--subtle)' }}>Held because <b style={{ color: 'var(--ink-2)' }}>{ruleInWords(t.rule)}</b></div>}
            </div>
            {!t.example && (isOwner ? (
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => write('approve', [t.paymentId, false, 0n])} className="px-5 py-2 text-sm font-semibold disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Approve</button>
                <button disabled={busy} onClick={() => write('deny', [t.paymentId])} className="px-5 py-2 text-sm font-semibold disabled:opacity-40"
                  style={{ border: '1px solid var(--border-strong)', color: 'var(--ink)' }}>Deny</button>
              </div>
            ) : (
              <div className="text-xs" style={{ color: 'var(--subtle)' }}>Only the owner can answer.</div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function RulesSummary({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { policy, frozen, allowlistSize } = useVault()
  const row = (k: string, v: string) => (
    <div className="flex justify-between px-4 py-3 text-sm" style={{ borderTop: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span><span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{v}</span>
    </div>
  )
  return (
    <div className="overflow-hidden" style={card}>
      <div className="px-4 py-3 text-xs" style={{ color: 'var(--subtle)' }}>Set by you, enforced by the contract. The agent can read these but never change them.</div>
      {row('Spend per day', policy ? `$${money(policy.dailyCap)}` : '—')}
      {row('Per payment', policy ? `$${money(policy.perPaymentCap)}` : '—')}
      {row('Payments per hour', policy ? String(policy.maxPerHour) : '—')}
      {row('Paying someone new', allowlistSize ? 'Ask me first' : 'Allowed until you add a payee')}
      {row('Emergency stop', frozen ? 'Frozen' : 'Off')}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
        <button onClick={onOpenSettings} className="text-sm font-semibold hover:underline" style={{ color: 'var(--link)' }}>Change in Settings →</button>
      </div>
    </div>
  )
}

export function Wallet({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { network } = useNetwork()
  const { allowlistSize } = useVault()
  const { nameOf } = usePayees(allowlistSize)
  const { feed, isExample, isLoading } = useFeed()
  const [filter, setFilter] = useState<Filter>('all')
  const [tab, setTab] = useState<'activity' | 'payees' | 'rules'>('activity')
  const shown = feed.filter(t => matches(filter, t))
  const seen = feed.filter(t => !t.example).flatMap(t => (t.counterparty ? [t.counterparty] : []))

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-[minmax(0,1fr)_230px] gap-4">
        <AgentCard />
        <div>
          <TodayTiles feed={feed} filter={filter} setFilter={f => { setFilter(f); setTab('activity') }} />
          <a href={network.vault ? addressUrl(network, network.vault) : '#'} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-xs font-semibold hover:underline" style={{ color: 'var(--link)' }}>
            Every payment is on Arc. Check it <ExternalLink size={11} />
          </a>
        </div>
      </div>

      <ActionTiles />
      <AskingCards feed={feed} nameOf={nameOf} />

      <div className="flex items-center gap-1 pt-2">
        {(['activity', 'payees', 'rules'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className="px-4 py-2 text-sm font-semibold capitalize"
            style={{ background: tab === t ? 'var(--surface-strong)' : 'transparent', color: tab === t ? 'var(--ink)' : 'var(--subtle)' }}>
            {t}
          </button>
        ))}
        {tab === 'activity' && filter !== 'all' && (
          <button onClick={() => setFilter('all')} className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>Showing one kind · show all</button>
        )}
      </div>

      {tab === 'activity' && (isLoading
        ? <div className="text-sm px-1" style={{ color: 'var(--subtle)' }}>Loading payments from Arc…</div>
        : <TxList items={shown} nameOf={nameOf} isExample={isExample} />)}
      {tab === 'payees' && <Payees seen={seen} />}
      {tab === 'rules' && <RulesSummary onOpenSettings={onOpenSettings} />}
    </div>
  )
}
