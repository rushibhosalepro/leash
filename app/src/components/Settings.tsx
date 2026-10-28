import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { isAddress } from 'viem'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { displayToNative, nativeToDisplay, shortAddr, type LeashPolicy } from '@/leash-contract'
import { useNetwork, addressUrl } from '@/network'
import { useVault, useVaultWrite } from '@/useVault'
import { useAgentLink, maskLink } from '@/useAgentLink'
import { useFeed } from '@/feed'

const usd = (v: bigint) => String(Number(nativeToDisplay(v)))
const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20 } as const
const field = { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' } as const
const primary = { background: 'var(--accent)', color: 'var(--on-accent)' } as const
const quiet = { border: '1px solid var(--border-strong)', color: 'var(--ink-2)' } as const
const danger = { background: 'var(--blocked-bg)', color: 'var(--blocked)', border: '1px solid var(--blocked-border)' } as const
// An address nobody holds a key for: setting it as the agent disconnects every agent.
const NO_AGENT = '0x000000000000000000000000000000000000dEaD'

const SECTIONS = [
  ['emergency', 'Emergency stop'], ['limits', 'Spending limits'], ['payees', 'New payees'],
  ['alerts', 'Approvals & alerts'], ['access', 'Agent access'], ['funds', 'Funds & account'],
] as const

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} className="p-5 scroll-mt-24" style={card}>
      <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{sub}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

function Row({ title, sub, children, soon }: { title: string; sub?: string; children?: React.ReactNode; soon?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2" style={{ opacity: soon ? 0.55 : 1 }}>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {title}{soon && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-strong)', color: 'var(--subtle)' }}>Not available yet</span>}
        </div>
        {sub && <div className="text-xs" style={{ color: 'var(--subtle)' }}>{sub}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  )
}

function Toggle({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span aria-disabled={disabled} className="inline-flex w-10 h-6 rounded-full p-0.5 transition-colors"
      style={{ background: on ? 'var(--ink)' : 'var(--surface-strong)', cursor: disabled ? 'not-allowed' : 'default' }}>
      <span className="w-5 h-5 rounded-full transition-transform" style={{ background: on ? 'var(--bg)' : 'var(--subtle)', transform: on ? 'translateX(16px)' : 'none' }} />
    </span>
  )
}

const PRESETS: { label: string; daily: string; each: string }[] = [
  { label: 'Careful · $1/day', daily: '1', each: '0.25' },
  { label: 'Normal · $10/day', daily: '10', each: '2' },
  { label: 'Busy · $50/day', daily: '50', each: '10' },
]

/** The limits sentence. Keyed by the on-chain policy, so the inputs reset after a confirmed save. */
function LimitsSection({ policy, canEdit }: { policy: LeashPolicy; canEdit: boolean }) {
  const { write, busy } = useVaultWrite()
  const [daily, setDaily] = useState(usd(policy.dailyCap))
  const [each, setEach] = useState(usd(policy.perPaymentCap))
  const [hourly, setHourly] = useState(policy.maxPerHour.toString())
  const dirty = daily !== usd(policy.dailyCap) || each !== usd(policy.perPaymentCap) || hourly !== policy.maxPerHour.toString()
  const clean = (v: string) => v.replace(/[^0-9.]/g, '')
  const input = (value: string, set: (v: string) => void, w = 'w-20') => (
    <input value={value} onChange={e => set(clean(e.target.value))} disabled={!canEdit} inputMode="decimal"
      className={`${w} mx-1 px-2 py-1 text-center tabular-nums font-semibold disabled:opacity-70`} style={{ ...field, borderRadius: 10 }} />
  )
  const save = () => write('setPolicy', [policy.agent, displayToNative(each || '0'), displayToNative(daily || '0'), BigInt(hourly || '0')])

  return (
    <Section id="limits" title="Spending limits" sub="Anything over a limit isn’t lost. It waits for you to approve.">
      <p className="text-base leading-10" style={{ color: 'var(--ink-2)' }}>
        The agent can spend up to ${input(daily, setDaily)} a day, ${input(each, setEach)} per payment, and make at most {input(hourly, setHourly, 'w-14')} payments an hour.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span style={{ color: 'var(--subtle)' }}>Quick presets:</span>
        {PRESETS.map(p => (
          <button key={p.label} disabled={!canEdit} onClick={() => { setDaily(p.daily); setEach(p.each) }}
            className="px-3 py-1 font-semibold disabled:opacity-50" style={{ background: 'var(--surface-strong)', color: 'var(--ink-2)' }}>{p.label}</button>
        ))}
      </div>
      {dirty && (
        <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 p-3 mt-2" style={{ ...card, borderRadius: 16, background: 'var(--surface-strong)' }}>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Changes are saved to your vault on Arc. Your wallet will ask you to confirm.</span>
          <span className="flex gap-2">
            <button onClick={() => { setDaily(usd(policy.dailyCap)); setEach(usd(policy.perPaymentCap)); setHourly(policy.maxPerHour.toString()) }}
              className="px-4 py-1.5 text-sm font-semibold" style={quiet}>Discard</button>
            <button disabled={busy || !canEdit} onClick={save} className="px-4 py-1.5 text-sm font-semibold disabled:opacity-40" style={primary}>Save changes</button>
          </span>
        </div>
      )}
    </Section>
  )
}

function AgentWalletRow({ policy, canEdit }: { policy: LeashPolicy; canEdit: boolean }) {
  const { network } = useNetwork()
  const { write, busy } = useVaultWrite()
  const [editing, setEditing] = useState(false)
  const [agent, setAgent] = useState<string>(policy.agent)
  return (
    <div className="p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>Agent wallet · the only wallet that can spend</div>
          <div className="text-sm mono truncate" style={{ color: 'var(--ink)' }}>{shortAddr(policy.agent)}</div>
        </div>
        <span className="flex gap-2 shrink-0">
          <a href={addressUrl(network, policy.agent)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold" style={quiet}>
            Explorer <ExternalLink size={11} />
          </a>
          <button disabled={!canEdit} onClick={() => setEditing(v => !v)} className="px-3 py-1.5 text-xs font-semibold disabled:opacity-40" style={quiet}>Change</button>
        </span>
      </div>
      {editing && (
        <div className="flex gap-2 mt-3">
          <input value={agent} onChange={e => setAgent(e.target.value.trim())} className="flex-1 px-3 py-2 text-xs mono" style={{ ...field, borderRadius: 10 }} />
          <button disabled={busy || !isAddress(agent) || agent.toLowerCase() === policy.agent.toLowerCase()}
            onClick={() => write('setPolicy', [agent, policy.perPaymentCap, policy.dailyCap, policy.maxPerHour])}
            className="px-4 py-2 text-xs font-semibold disabled:opacity-40" style={primary}>Save</button>
        </div>
      )}
    </div>
  )
}

function exportCsv(rows: ReturnType<typeof useFeed>['feed']) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [['time', 'status', 'amount_usdc', 'payee', 'reason', 'rule_or_error', 'tx'].join(',')]
    .concat(rows.filter(r => !r.example).map(r => [new Date(r.time).toISOString(), r.status, r.amount, r.counterparty, r.reason, r.error ?? r.rule, r.tx].map(esc).join(',')))
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `leash-history-${new Date().toISOString().slice(0, 10)}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}

export function Settings({ onBack }: { onBack: (tab?: 'payees') => void }) {
  const { address } = useAccount()
  const { policy, frozen, balance, isOwner, owner, allowlistSize } = useVault()
  const { write, busy } = useVaultWrite()
  const { online, info, control } = useAgentLink()
  const { feed } = useFeed()
  const canEdit = isOwner && !busy
  const policyKey = policy ? `${policy.agent}-${policy.perPaymentCap}-${policy.dailyCap}-${policy.maxPerHour}` : 'none'

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={() => onBack()} className="flex items-center gap-1 text-sm font-semibold mb-4" style={{ color: 'var(--link)' }}>
        <ArrowLeft size={14} /> Back to wallet
      </button>
      <h1 className="display text-3xl" style={{ color: 'var(--ink)' }}>Settings</h1>
      <p className="text-sm mt-1 mb-6" style={{ color: 'var(--subtle)' }}>Everything here is yours alone. The agent can read these rules, but it can never change them.</p>

      {!isOwner && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 mb-5" style={{ ...card, borderColor: 'var(--held-border)', background: 'var(--held-bg)' }}>
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
            {address ? <>Connected as <span className="mono">{shortAddr(address)}</span>. Only the owner <span className="mono">{shortAddr(owner)}</span> can change settings.</>
              : <>Read-only until you connect the owner wallet <span className="mono">{shortAddr(owner)}</span>.</>}
          </span>
          {!address && <ConnectKitButton label="Connect owner wallet" />}
        </div>
      )}

      <div className="grid lg:grid-cols-[180px_minmax(0,1fr)] gap-6 items-start">
        <nav className="hidden lg:flex flex-col gap-1 sticky top-20">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#settings-${id}`} className="px-3 py-2 text-sm" style={{ color: 'var(--muted)', borderRadius: 10 }}>{label}</a>
          ))}
        </nav>

        <div className="space-y-4 min-w-0">
          <Section id="emergency" title="Emergency stop">
            <Row title="Freeze account" sub="Stop every payment instantly. The agent stays connected, but nothing goes through until you unfreeze.">
              <button disabled={!canEdit} onClick={() => write(frozen ? 'unfreeze' : 'freeze')} className="px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={frozen ? primary : danger}>{frozen ? 'Unfreeze' : 'Freeze now'}</button>
            </Row>
            <Row soon title="Freeze automatically if something looks wrong" sub="After 3 blocked payments within an hour, freeze and tell me.">
              <Toggle on={false} disabled />
            </Row>
          </Section>

          {policy && <LimitsSection key={`limits-${policyKey}`} policy={policy} canEdit={canEdit} />}

          <Section id="payees" title="When the agent pays someone new" sub="Someone who isn’t in your payees yet.">
            <label className="flex gap-3 p-3 cursor-default" style={{ background: 'var(--bg)', border: '1px solid var(--ink)', borderRadius: 14 }}>
              <input type="radio" checked readOnly className="mt-1" />
              <span>
                <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>Ask me first</span>
                <span className="block text-xs" style={{ color: 'var(--subtle)' }}>Hold the payment until I approve. Enforced by the contract.</span>
              </span>
            </label>
            <label className="flex gap-3 p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, opacity: 0.55 }}>
              <input type="radio" disabled className="mt-1" />
              <span>
                <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>Block it <span className="ml-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Not available yet</span></span>
                <span className="block text-xs" style={{ color: 'var(--subtle)' }}>Only ever pay people already in my payees.</span>
              </span>
            </label>
            {!allowlistSize && (
              <div className="text-xs p-3" style={{ background: 'var(--held-bg)', borderRadius: 12, color: 'var(--ink-2)' }}>
                You have no activated payee yet, so right now the agent can pay anyone within your limits. Activate one payee to switch “ask me first” on.
              </div>
            )}
            <button onClick={() => onBack('payees')} className="text-xs font-semibold hover:underline" style={{ color: 'var(--link)' }}>Manage payees →</button>
          </Section>

          <Section id="alerts" title="Approvals & alerts">
            <Row soon title="Tell me when a payment is held" sub="So the agent isn’t left waiting."><Toggle on={false} disabled /></Row>
            <Row soon title="Tell me when a payment is blocked" sub="Could mean the agent is confused or being tricked."><Toggle on={false} disabled /></Row>
            <Row soon title="Held payments expire" sub="If you don’t answer, the payment is cancelled. No money moves."><Toggle on={false} disabled /></Row>
            <div className="text-xs" style={{ color: 'var(--subtle)' }}>Held payments show on your wallet page with Approve and Deny, and stay there until you answer.</div>
          </Section>

          <Section id="access" title="Agent access">
            {policy && <AgentWalletRow key={policy.agent} policy={policy} canEdit={canEdit} />}
            <div className="p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14 }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs" style={{ color: 'var(--subtle)' }}>Agent link (MCP) · {!online ? 'server offline' : info?.on ? 'on' : 'off'}</div>
                  <div className="text-sm mono truncate" style={{ color: 'var(--ink)' }}>{info?.link ? maskLink(info.link) : '—'}</div>
                </div>
                <span className="flex gap-2 shrink-0">
                  <button disabled={!online || !info?.on} onClick={() => control('rotate')} className="px-3 py-1.5 text-xs font-semibold disabled:opacity-40" style={quiet}>New link</button>
                  <button disabled={!online} onClick={() => control(info?.on ? 'off' : 'on')} className="px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    style={info?.on ? danger : primary}>{info?.on ? 'Turn off' : 'Turn on'}</button>
                </span>
              </div>
              <div className="text-[11px] mt-2" style={{ color: 'var(--subtle)' }}>“New link” stops the old one at once. Use it if the link was ever shared by mistake. These controls run on this computer’s agent server.</div>
            </div>
            <Row title="Require a reason with every payment" sub="Always on: the agent server refuses a payment without one, and the reason is written on-chain.">
              <Toggle on disabled />
            </Row>
          </Section>

          <Section id="funds" title="Funds & account">
            <Row title="Withdraw everything" sub={`Send all ${balance === undefined ? '—' : Number(nativeToDisplay(balance)).toFixed(2)} USDC back to the owner wallet ${shortAddr(owner)}.`}>
              <button disabled={!canEdit || !balance} onClick={() => write('withdrawAll')} className="px-4 py-2 text-sm font-semibold disabled:opacity-40" style={quiet}>Withdraw all</button>
            </Row>
            <Row title="Disconnect the agent" sub="Removes the agent wallet and turns off its link. Your USDC stays in the vault.">
              <button disabled={!canEdit || !policy || policy.agent.toLowerCase() === NO_AGENT.toLowerCase()}
                onClick={async () => { await write('setPolicy', [NO_AGENT, policy!.perPaymentCap, policy!.dailyCap, policy!.maxPerHour]); if (online && info?.on) void control('off') }}
                className="px-4 py-2 text-sm font-semibold disabled:opacity-40" style={danger}>Disconnect</button>
            </Row>
            <Row title="Export history" sub="Every payment, reason and decision as a CSV file.">
              <button onClick={() => exportCsv(feed)} className="px-4 py-2 text-sm font-semibold" style={quiet}>Download CSV</button>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  )
}
