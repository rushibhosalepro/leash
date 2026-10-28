import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useVault } from './useVault'
import { Header } from './components/Header'
import { Wallet } from './components/Wallet'
import { Settings } from './components/Settings'
import { DeployVault } from './components/DeployVault'
import { ConnectAgent } from './components/ConnectAgent'
import { useNetwork, addressUrl } from './network'
import { shortAddr } from './leash-contract'

type View = 'wallet' | 'settings'

/**
 * Everything on the page is read from a public contract, so it shows with or without a wallet.
 * Say so plainly, so a visitor does not mistake the demo vault's data for their own.
 */
function VaultLabel() {
  const { network } = useNetwork()
  const { address } = useAccount()
  const { isOwner, owner } = useVault()
  if (!network.vault) return null
  const vaultLink = (
    <a href={addressUrl(network, network.vault)} target="_blank" rel="noopener noreferrer" className="mono underline" style={{ color: 'var(--ink-2)' }}>
      {shortAddr(network.vault)}
    </a>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-5 px-4 py-2.5 text-xs"
      style={{ borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isOwner ? 'var(--paid)' : 'var(--held)' }} />
      {isOwner ? (
        <span>Your vault {vaultLink} on Arc {network.label}. You can manage it.</span>
      ) : (
        <span>
          Public demo vault {vaultLink} on Arc {network.label} · <strong style={{ color: 'var(--ink-2)' }}>read-only</strong>.
          {' '}Everything here is public on-chain data, not your wallet’s.
          {' '}{address ? <>Only the owner <span className="mono">{shortAddr(owner)}</span> can manage it.</> : 'Connect the owner wallet to manage it.'}
        </span>
      )}
    </div>
  )
}

export default function App() {
  const { network } = useNetwork()
  const [view, setView] = useState<View>('wallet')

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Header view={view} onView={setView} />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {!network.vault ? (
          <DeployVault />
        ) : (
          <>
          <VaultLabel />
          {view === 'settings' ? (
            <Settings onBack={() => setView('wallet')} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
              <div className="min-w-0"><Wallet onOpenSettings={() => setView('settings')} /></div>
              <ConnectAgent />
            </div>
          )}
          </>
        )}
      </main>

      {network.vault && (
        <footer className="pb-8 text-center text-xs" style={{ color: 'var(--subtle)' }}>
          Vault{' '}
          <a href={addressUrl(network, network.vault)} target="_blank" rel="noopener noreferrer" className="underline mono">
            {shortAddr(network.vault)}
          </a>{' '}
          on Arc {network.label}
        </footer>
      )}
    </div>
  )
}
