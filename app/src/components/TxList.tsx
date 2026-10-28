import { ArrowUpRight } from 'lucide-react'
import { ruleInWords, shortAddr } from '@/leash-contract'
import { useNetwork, txUrl } from '@/network'
import { dayLabel, isOut, type Status, type Tx } from '@/feed'

const STATUS: Record<Status, { label: string; color: string; sign: '−' | '+' | ''; struck?: boolean }> = {
  sent: { label: 'Paid alone', color: 'var(--paid)', sign: '−' },
  approved: { label: 'Approved by you', color: 'var(--paid)', sign: '−' },
  waiting: { label: 'Waiting for you', color: 'var(--held)', sign: '−' },
  denied: { label: 'Denied by you', color: 'var(--subtle)', sign: '', struck: true },
  blocked: { label: 'Blocked', color: 'var(--blocked)', sign: '', struck: true },
  failed: { label: 'Failed', color: 'var(--subtle)', sign: '', struck: true },
  deposit: { label: 'Added', color: 'var(--paid)', sign: '+' },
  withdrawal: { label: 'Withdrawn', color: 'var(--ink-2)', sign: '−' },
}

const time = (ms: number) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '')

function Row({ t, name }: { t: Tx; name: string | null }) {
  const { network } = useNetwork()
  const s = STATUS[t.status]
  const title = t.status === 'deposit' ? 'Added funds' : t.status === 'withdrawal' ? 'Withdrawal' : name ?? (t.counterparty ? shortAddr(t.counterparty) : 'Unknown')
  const why = t.error ?? (t.rule && t.status !== 'sent' ? ruleInWords(t.rule) : '')
  return (
    <div className="flex gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
        style={{ background: 'var(--surface-strong)', color: 'var(--ink)' }}>
        {t.status === 'deposit' ? '+' : t.status === 'withdrawal' ? '↑' : title.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>
          {title}
          {name && t.counterparty && <span className="ml-2 text-[11px] font-normal mono" style={{ color: 'var(--subtle)' }}>{shortAddr(t.counterparty)}</span>}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--subtle)' }}>
          {time(t.time)}{t.reason && <> · “{t.reason}”</>}
        </div>
        {why && <div className="text-[11px] mt-0.5" style={{ color: s.color === 'var(--subtle)' ? 'var(--blocked)' : s.color }}>{why}</div>}
        {!!t.notes?.length && (
          <div className="mt-1 space-y-0.5 pl-2.5" style={{ borderLeft: '2px solid var(--border-strong)' }}>
            {t.notes.map((n, i) => <div key={i} className="text-xs" style={{ color: 'var(--ink-2)' }}><span style={{ color: 'var(--subtle)' }}>Note · </span>{n.note}</div>)}
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold tabular-nums"
          style={{ color: t.status === 'deposit' ? 'var(--paid)' : s.struck ? 'var(--subtle)' : 'var(--ink)', textDecoration: s.struck ? 'line-through' : undefined }}>
          {s.sign}${t.amount.toFixed(2)}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</div>
      </div>
      <div className="w-4 shrink-0 pt-1">
        {t.example ? null : t.tx && (
          <a href={txUrl(network, t.tx)} target="_blank" rel="noopener noreferrer" title="Check it on Arc" style={{ color: 'var(--subtle)' }}>
            <ArrowUpRight size={14} />
          </a>
        )}
      </div>
    </div>
  )
}

/** The feed grouped by day, each day headed by what left the vault and how many agent payments it had. */
export function TxList({ items, nameOf, isExample }: { items: Tx[]; nameOf: (a: string) => string | null; isExample: boolean }) {
  const days = items.reduce<{ day: string; items: Tx[] }[]>((acc, t) => {
    const day = dayLabel(t.time)
    const last = acc[acc.length - 1]
    if (last?.day === day) last.items.push(t); else acc.push({ day, items: [t] })
    return acc
  }, [])

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {days.map(({ day, items }) => {
        const out = items.filter(t => isOut(t.status) && t.status !== 'withdrawal').reduce((n, t) => n + t.amount, 0)
        const payments = items.filter(t => t.counterparty).length
        return (
          <div key={day}>
            <div className="flex justify-between px-4 py-2.5 text-xs" style={{ color: 'var(--subtle)', borderTop: '1px solid var(--border)' }}>
              <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{day}</span>
              <span className="tabular-nums">{out > 0 ? `−$${out.toFixed(2)} · ` : ''}{payments} payment{payments === 1 ? '' : 's'}</span>
            </div>
            {items.map(t => <Row key={t.key} t={t} name={t.name ?? (t.counterparty ? nameOf(t.counterparty) : null)} />)}
          </div>
        )
      })}
      {items.length === 0 && <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--subtle)' }}>Nothing here yet.</div>}
      <div className="px-4 py-3 text-xs" style={{ color: 'var(--subtle)', borderTop: '1px solid var(--border)' }}>
        {isExample ? 'Examples. Real payments replace these the moment your agent tries one.' : 'New payments appear here the moment your agent tries one.'}
      </div>
    </div>
  )
}
