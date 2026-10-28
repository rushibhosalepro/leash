import { useState } from 'react'
import { isAddress } from 'viem'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { displayToNative, nativeToDisplay, shortAddr, type LeashPolicy } from '@/leash-contract'
import { useNetwork, addressUrl } from '@/network'
import { useVault, useVaultWrite } from '@/useVault'

const usd = (v: bigint) => String(Number(nativeToDisplay(v)))

const btn = 'px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-40'
const primary = { background: 'var(--accent)', color: 'var(--on-accent)' }
const field = { background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
      {children}
    </section>
  )
}

function Inline({ value, onChange, disabled, width = 'w-16' }: { value: string; onChange: (v: string) => void; disabled: boolean; width?: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} disabled={disabled} inputMode="decimal"
      className={`${width} mx-1 px-2 py-0.5 rounded-md text-center tabular-nums disabled:opacity-80`} style={field} />
  )
}

// setPolicy writes the agent and all three limits together, so both forms below submit the full policy.
function usePolicyWrite() {
  const { write, busy } = useVaultWrite()
  const save = (p: LeashPolicy) => write('setPolicy', [p.agent, p.perPaymentCap, p.dailyCap, p.maxPerHour])
  return { save, busy }
}

/**
 * One global rule: how much the agent may spend per day. The contract's vault-wide per-payment cap is kept equal to
 * the daily cap so it never adds a second rule; per-payment limits are set per payee. Keyed by the on-chain policy.
 */
function DailyLimitForm({ policy, isOwner }: { policy: LeashPolicy; isOwner: boolean }) {
  const { save, busy } = usePolicyWrite()
  const [daily, setDaily] = useState(usd(policy.dailyCap))
  const editable = isOwner && !busy
  return (
    <Card title="Daily limit">
      <p className="text-base leading-9" style={{ color: 'var(--muted)' }}>
        The agent can spend up to $<Inline value={daily} onChange={setDaily} disabled={!editable} /> a day in total.
      </p>
      <div className="text-xs" style={{ color: 'var(--subtle)' }}>
        Each payee also has its own per-payment limit (Activity → Payees). Anything over a limit, or to someone not in your payees, waits for you.
      </div>
      {isOwner && (
        <button disabled={busy || !Number(daily)} className={btn} style={primary}
          onClick={() => { const d = displayToNative(daily); void save({ ...policy, perPaymentCap: d, dailyCap: d }) }}>
          Save
        </button>
      )}
    </Card>
  )
}

function AgentForm({ policy, isOwner }: { policy: LeashPolicy; isOwner: boolean }) {
  const { network } = useNetwork()
  const { save, busy } = usePolicyWrite()
  const [agent, setAgent] = useState<string>(policy.agent)
  return (
    <Card title="Agent wallet">
      <div className="text-xs -mt-1" style={{ color: 'var(--subtle)' }}>The only wallet that can spend from the vault, and only inside these rules.</div>
      {isOwner ? (
        <div className="flex gap-2">
          <input value={agent} onChange={e => setAgent(e.target.value.trim())} className="flex-1 px-2 py-1.5 rounded-md text-xs mono" style={field} />
          <button disabled={busy || !isAddress(agent) || agent.toLowerCase() === policy.agent.toLowerCase()} className={btn} style={primary}
            onClick={() => save({ ...policy, agent: agent as `0x${string}` })}>
            Change
          </button>
        </div>
      ) : (
        <a href={addressUrl(network, policy.agent)} target="_blank" rel="noopener noreferrer" className="text-sm mono" style={{ color: 'var(--muted)' }}>{policy.agent}</a>
      )}
    </Card>
  )
}

/** Shown instead of the edit controls when the connected wallet is not the owner (or none is connected). */
function OwnerGate({ owner }: { owner?: string }) {
  const { address } = useAccount()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
      style={{ background: 'var(--held-bg)', border: '1px solid var(--held-border)' }}>
      <div className="text-sm" style={{ color: 'var(--ink-2)' }}>
        {address
          ? <>You are connected as <span className="mono">{shortAddr(address)}</span>. Only the owner <span className="mono">{shortAddr(owner)}</span> can edit these rules. Switch accounts in your wallet.</>
          : <>Rules are read-only until you connect the owner wallet <span className="mono">{shortAddr(owner)}</span>. The agent can never edit them.</>}
      </div>
      {!address && <ConnectKitButton label="Connect owner wallet to edit" />}
    </div>
  )
}

export function Rules() {
  const { policy, frozen, isOwner, owner } = useVault()
  const { write, busy } = useVaultWrite()
  const policyKey = policy ? `${policy.agent}-${policy.perPaymentCap}-${policy.dailyCap}-${policy.maxPerHour}` : 'none'

  return (
    <div className="space-y-4">
      {!isOwner && <OwnerGate owner={owner} />}

      {policy && <DailyLimitForm key={`limits-${policyKey}`} policy={policy} isOwner={isOwner} />}

      <Card title="Emergency stop">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm" style={{ color: frozen ? 'var(--blocked)' : 'var(--muted)' }}>
            {frozen ? 'Frozen: every payment is blocked until you unfreeze.' : 'Running. Freeze to block every payment instantly.'}
          </div>
          {isOwner && (
            <button disabled={busy} onClick={() => write(frozen ? 'unfreeze' : 'freeze')} className={btn}
              style={frozen ? primary : { background: 'var(--blocked-bg)', color: 'var(--blocked)', border: '1px solid var(--blocked-border)' }}>
              {frozen ? 'Unfreeze' : 'Freeze'}
            </button>
          )}
        </div>
      </Card>

      {policy && <AgentForm key={`agent-${policyKey}`} policy={policy} isOwner={isOwner} />}
    </div>
  )
}
