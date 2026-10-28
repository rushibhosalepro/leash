import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider } from 'viem'
import { shortAddr, walletErrorMessage } from '@/leash-contract'
import { useNetwork } from '@/network'

// Arc App Kit chain names. Mainnet routes for Arc mainnet, Sepolia-style routes for Arc testnet.
const SOURCES = {
  mainnet: { to: 'Arc', from: ['Base', 'Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'Unichain', 'Linea'] },
  testnet: { to: 'Arc_Testnet', from: ['Ethereum_Sepolia', 'Base_Sepolia', 'Arbitrum_Sepolia'] },
} as const

const field = { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)', borderRadius: 12 } as const
const pretty = (c: string) => c.replace(/_/g, ' ')

type Step = { name: string; state: string; explorerUrl?: string }

/**
 * Moves USDC from another chain onto Arc with Arc's App Kit (Circle CCTP). The user signs only on the source chain;
 * the Forwarding Service submits the mint on Arc, so the Arc wallet needs no USDC for fees beforehand.
 */
export function BridgeToArc() {
  const { network } = useNetwork()
  const { address, connector } = useAccount()
  const routes = SOURCES[network.id]
  const [from, setFrom] = useState<string>(routes.from[0])
  const [amount, setAmount] = useState('5')
  const [quote, setQuote] = useState<string | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [busy, setBusy] = useState<null | 'estimate' | 'bridge'>(null)
  const [done, setDone] = useState(false)

  async function setup() {
    if (!connector || !address) throw new Error('Connect your wallet first')
    const provider = (await connector.getProvider()) as EIP1193Provider
    const adapter = await createViemAdapterFromProvider({ provider })
    const kit = new AppKit()
    const params = {
      from: { adapter, chain: from },
      to: { recipientAddress: address, chain: routes.to, useForwarder: true },
      amount,
    } as unknown as Parameters<AppKit['bridge']>[0]
    return { kit, params }
  }

  async function estimate() {
    setBusy('estimate'); setQuote(null)
    try {
      const { kit, params } = await setup()
      const est = await kit.estimateBridge(params as never) as { fees?: { type?: string; amount?: string | null; token?: string }[] }
      const fees = (est.fees ?? []).filter(f => f.amount && Number(f.amount) > 0)
      setQuote(fees.length ? fees.map(f => `${f.type ?? 'fee'}: ${f.amount} ${f.token ?? 'USDC'}`).join(' · ') : 'No USDC fees quoted (you still pay gas on the source chain).')
    } catch (err) {
      toast.error(walletErrorMessage(err, 'Could not estimate the bridge'))
    } finally { setBusy(null) }
  }

  async function bridge() {
    setBusy('bridge'); setSteps([]); setDone(false)
    try {
      const { kit, params } = await setup()
      kit.on('*', (payload: unknown) => {
        const v = (payload as { values?: Step }).values
        if (v?.name) setSteps(s => [...s.filter(x => x.name !== v.name), { name: v.name, state: v.state, explorerUrl: v.explorerUrl }])
      })
      const result = await kit.bridge(params)
      if (result.state === 'error') throw new Error('The bridge stopped part-way. Open it again to retry the remaining step.')
      setDone(true)
      toast.success(`USDC is on its way to Arc ${network.label}`)
    } catch (err) {
      toast.error(walletErrorMessage(err, 'Bridge did not complete'))
    } finally { setBusy(null) }
  }

  return (
    <div className="p-5 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20 }}>
      <div>
        <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>Bring USDC to Arc</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
          Uses Arc’s App Kit (Circle CCTP). You sign on the source chain only; Circle completes the mint on Arc, so you need no USDC on Arc yet.
        </p>
      </div>

      {!address ? (
        <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--muted)' }}>Connect the wallet that holds the USDC.<ConnectKitButton /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
            <span>Send</span>
            <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal"
              className="w-20 px-2 py-1.5 text-center tabular-nums" style={field} />
            <span>USDC from</span>
            <select value={from} onChange={e => { setFrom(e.target.value); setQuote(null) }} className="px-2 py-1.5" style={field}>
              {routes.from.map(c => <option key={c} value={c}>{pretty(c)}</option>)}
            </select>
            <ArrowRight size={14} style={{ color: 'var(--subtle)' }} />
            <span className="font-semibold">{pretty(routes.to)}</span>
            <span className="text-xs mono" style={{ color: 'var(--subtle)' }}>to {shortAddr(address)}</span>
          </div>
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>
            Your wallet needs that USDC on {pretty(from)}, plus a little of {pretty(from)}’s own gas token for the approve and burn.
          </div>

          <div className="flex flex-wrap gap-2">
            <button disabled={!!busy || !Number(amount)} onClick={estimate} className="px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--ink)' }}>{busy === 'estimate' ? 'Estimating…' : 'Estimate fees'}</button>
            <button disabled={!!busy || !Number(amount)} onClick={bridge} className="px-5 py-2 text-sm font-bold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{busy === 'bridge' ? 'Bridging… confirm in your wallet' : `Bridge to ${pretty(routes.to)}`}</button>
          </div>
          {quote && <div className="text-xs" style={{ color: 'var(--ink-2)' }}>{quote}</div>}

          {steps.length > 0 && (
            <ol className="space-y-1 text-xs">
              {steps.map(s => (
                <li key={s.name} className="flex items-center gap-2" style={{ color: s.state === 'error' ? 'var(--blocked)' : s.state === 'success' ? 'var(--paid)' : 'var(--muted)' }}>
                  <span className="capitalize font-semibold">{s.name}</span> · {s.state}
                  {s.explorerUrl && <a href={s.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">tx <ExternalLink size={10} /></a>}
                </li>
              ))}
            </ol>
          )}
          {done && <div className="text-xs" style={{ color: 'var(--paid)' }}>Done. Your USDC balance on Arc updates in a moment.</div>}
        </>
      )}
    </div>
  )
}
