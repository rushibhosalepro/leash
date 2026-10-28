import { useState } from 'react'
import { useReadContracts } from 'wagmi'
import { isAddress } from 'viem'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { LEASH_ABI, displayToNative, nativeToDisplay, shortAddr } from '@/leash-contract'
import { useNetwork, addressUrl } from '@/network'
import { useVault, useVaultWrite } from '@/useVault'
import { usePayees, usePayeeEditor, type PayeeEntry, type PayeeStatus } from '@/usePayees'

// Simple model: a payee on the on-chain list can be paid up to its per-payment limit; anyone else waits for the owner.
const STATUS: Record<PayeeStatus, { label: string; color: string; bg: string }> = {
  trusted: { label: 'Can pay', color: 'var(--paid)', bg: 'var(--paid-bg)' },
  // Saved name, not on the on-chain payee list. Until any payee is activated the contract still lets the agent pay anyone.
  allowed: { label: 'Name only', color: 'var(--held)', bg: 'var(--held-bg)' },
  asks_first: { label: 'Not active', color: 'var(--held)', bg: 'var(--held-bg)' },
  blocked: { label: 'Blocked', color: 'var(--blocked)', bg: 'var(--blocked-bg)' },
}

const small = 'px-2 py-1 rounded-md text-xs font-medium disabled:opacity-40'
const field = { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }
const money = (v: bigint) => `$${Number(nativeToDisplay(v)).toFixed(2).replace(/\.00$/, '')}`
const toNative = (s: string) => { try { return s ? displayToNative(s) : 0n } catch { return 0n } }
const clean = (v: string) => v.replace(/[^0-9.]/g, '')

/** payeeLimit(payee) -> [perPaymentCap, dailyCap, spentToday, remainingToday]; only the per-payment cap is used. */
function usePerPaymentLimits(addresses: `0x${string}`[]) {
  const { network } = useNetwork()
  const { data } = useReadContracts({
    contracts: addresses.map(a => ({ address: network.vault ?? undefined, abi: LEASH_ABI, chainId: network.chain.id, functionName: 'payeeLimit', args: [a] })),
    query: { enabled: !!network.vault && addresses.length > 0, refetchInterval: 15000 },
  })
  const out = new Map<string, bigint>()
  addresses.forEach((a, i) => {
    const r = data?.[i]?.result
    if (Array.isArray(r) && (r[0] as bigint) > 0n) out.set(a.toLowerCase(), r[0] as bigint)
  })
  return out
}

function LimitInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="text-sm inline-flex items-center gap-1" style={{ color: 'var(--muted)' }}>
      Up to $<input value={value} onChange={e => onChange(clean(e.target.value))} placeholder="1.00" inputMode="decimal"
        className="w-20 px-2 py-1 rounded-md text-sm text-center tabular-nums" style={field} /> per payment
    </span>
  )
}

function PayeeRow({ p, limit, isOwner }: { p: PayeeEntry; limit?: bigint; isOwner: boolean }) {
  const { network } = useNetwork()
  const { write, busy } = useVaultWrite()
  const { remove } = usePayeeEditor()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(limit ? String(Number(nativeToDisplay(limit))) : '')
  const s = STATUS[p.status]

  const saveLimit = async () => {
    const v = toNative(value)
    await (v > 0n ? write('setPayeeLimit', [p.address, v, 0n]) : write('clearPayeeLimit', [p.address]))
    setEditing(false)
  }
  const removePayee = async () => {
    if (isOwner && p.status !== 'blocked') await write('setAllowlist', [[p.address], false])
    await remove(p.address)
  }

  return (
    <div className="py-2.5" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: 'var(--surface-strong)', color: 'var(--ink-2)' }}>
          {(p.name ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{p.name ?? 'Unnamed'}</div>
          <div className="text-xs flex flex-wrap gap-x-2" style={{ color: 'var(--subtle)' }}>
            <a href={addressUrl(network, p.address)} target="_blank" rel="noopener noreferrer" className="mono">{shortAddr(p.address)}</a>
            <span style={{ color: limit ? 'var(--ink-2)' : 'var(--subtle)' }}>
              {limit ? `up to ${money(limit)} per payment` : p.status === 'trusted' ? 'no per-payment limit (daily limit applies)' : isOwner ? 'not activated yet: click Activate, then set a Limit' : 'not activated: connect the owner wallet to activate and set a limit'}
            </span>
          </div>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md whitespace-nowrap"
          style={{ color: s.color, background: s.bg }}>{s.label}</span>
        {isOwner && (
          <div className="flex gap-1 shrink-0">
            <button onClick={() => setEditing(v => !v)} className={small} style={{ color: 'var(--accent)' }}>Limit</button>
            {(p.status === 'asks_first' || p.status === 'allowed') && (
              <button disabled={busy} onClick={() => write('setAllowlist', [[p.address], true])} className={small} style={{ color: 'var(--paid)' }}>Activate</button>
            )}
            <button disabled={busy} onClick={() => write('setDenylist', [[p.address], p.status !== 'blocked'])} className={small}
              style={{ color: p.status === 'blocked' ? 'var(--muted)' : 'var(--blocked)' }}>
              {p.status === 'blocked' ? 'Unblock' : 'Block'}
            </button>
            <button disabled={busy} onClick={removePayee} className={small} title="Remove payee" style={{ color: 'var(--subtle)' }}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 ml-11">
          <LimitInput value={value} onChange={setValue} />
          <button disabled={busy} onClick={saveLimit} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Save</button>
        </div>
      )}
    </div>
  )
}

function AddPayee({ isOwner, onDone, initialAddress = '' }: { isOwner: boolean; onDone: () => void; initialAddress?: string }) {
  const { save } = usePayeeEditor()
  const { write } = useVaultWrite()
  const [name, setName] = useState('')
  const [address, setAddress] = useState(initialAddress)
  const [limit, setLimit] = useState('1')
  const valid = name.trim().length > 0 && isAddress(address) && toNative(limit) > 0n

  const submit = async () => {
    try {
      await save(name, address)
      // Being on the list and the limit are enforced on-chain, so each needs the owner's signature.
      if (isOwner) {
        await write('setAllowlist', [[address], true])
        await write('setPayeeLimit', [address, toNative(limit), 0n])
      }
      toast.success(`${name.trim()} added`)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="grid sm:grid-cols-[1fr_1.4fr] gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. Weather API" maxLength={60}
          className="px-3 py-2 rounded-lg text-sm" style={field} />
        <input value={address} onChange={e => setAddress(e.target.value.trim())} placeholder="0x… address"
          className="px-3 py-2 rounded-lg text-sm mono" style={field} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LimitInput value={limit} onChange={setLimit} />
        <div className="flex gap-2">
          <button onClick={onDone} className={small} style={{ color: 'var(--subtle)' }}>Cancel</button>
          <button disabled={!valid} onClick={submit} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Add payee</button>
        </div>
      </div>
      {isOwner
        ? <div className="text-xs" style={{ color: 'var(--subtle)' }}>Your wallet asks you to confirm twice: adding the payee, then its limit.</div>
        : <div className="text-xs" style={{ color: 'var(--held)' }}>Connect the owner wallet to activate it. Without that, only the name is saved.</div>}
    </div>
  )
}

export function Payees({ seen = [] }: { seen?: `0x${string}`[] }) {
  const { isOwner, allowlistSize } = useVault()
  const { entries, directoryOnline } = usePayees(allowlistSize)
  const limits = usePerPaymentLimits(entries.map(e => e.address))
  const [adding, setAdding] = useState(false)
  const [prefill, setPrefill] = useState('')
  // Addresses the agent has paid or tried to pay that are not saved yet.
  const saved = new Set(entries.map(e => e.address.toLowerCase()))
  const unsaved = [...new Set(seen.map(a => a.toLowerCase()))].filter(a => !saved.has(a)) as `0x${string}`[]
  const startAdding = (address = '') => { setPrefill(address); setAdding(true) }

  return (
    <section className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>Payees</h2>
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>Who your agent can pay, and how much per payment. Anyone else waits for you.</div>
        </div>
        {!adding && directoryOnline && (
          <button onClick={() => startAdding()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0"
            style={{ background: 'var(--surface-strong)', color: 'var(--ink)' }}>
            <Plus size={14} /> Add payee
          </button>
        )}
      </div>

      {!directoryOnline && (
        <div className="text-xs py-2" style={{ color: 'var(--subtle)' }}>Names need the agent server running (<span className="mono">bun run start</span> in the mcp folder).</div>
      )}
      {entries.length === 0 && directoryOnline && !adding && (
        <div className="text-sm py-3" style={{ color: 'var(--subtle)' }}>
          No payees yet. Until you add one, the agent can pay anyone within the daily limit.
        </div>
      )}
      <div className="mt-2">
        {entries.map(p => {
          const limit = limits.get(p.address.toLowerCase())
          // Re-key on the on-chain limit so the edit input resets after a confirmed change.
          return <PayeeRow key={`${p.address}-${limit ?? 0}`} p={p} limit={limit} isOwner={isOwner} />
        })}
      </div>
      {adding && <AddPayee key={prefill} initialAddress={prefill} isOwner={isOwner} onDone={() => setAdding(false)} />}

      {unsaved.length > 0 && directoryOnline && (
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>Paid by your agent, not saved</div>
          <div className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>Save the ones you trust and give them a limit. Once any payee is saved, these wait for you.</div>
          {unsaved.map(a => (
            <div key={a} className="flex items-center gap-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--surface-strong)', color: 'var(--subtle)' }}>?</div>
              <span className="flex-1 text-sm mono truncate" style={{ color: 'var(--muted)' }}>{shortAddr(a)}</span>
              <button onClick={() => startAdding(a)} className="px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap"
                style={{ background: 'var(--surface-strong)', color: 'var(--ink)' }}>Save as payee</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
