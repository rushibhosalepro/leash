import { ConnectKitButton } from 'connectkit'
import { Shield, Settings as SettingsIcon } from 'lucide-react'
import { NETWORKS, useNetwork, type NetworkId } from '@/network'
import { useVault } from '@/useVault'
import { shortAddr } from '@/leash-contract'

function NetworkSwitch() {
  const { network, setNetwork } = useNetwork()

  // Both networks stay reachable so the owner can deploy a vault on one that has none yet.
  return (
    <div className="flex p-0.5 rounded-lg text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {(Object.keys(NETWORKS) as NetworkId[]).map(id => (
        <button
          key={id}
          onClick={() => setNetwork(id)}
          className="px-2.5 py-1 rounded-md font-medium"
          style={{
            background: network.id === id ? 'var(--accent)' : 'transparent',
            color: network.id === id ? 'var(--on-accent)' : 'var(--muted)',
          }}
        >
          {NETWORKS[id].label}{!NETWORKS[id].vault && <span className="ml-1 opacity-60">· set up</span>}
        </button>
      ))}
    </div>
  )
}

/** Owner chip when the owner's wallet is connected; the wallet button otherwise. Clicking either opens the wallet menu. */
function WalletChip() {
  const { isOwner } = useVault()
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, address, show }) =>
        isConnected && isOwner && address ? (
          <button onClick={show} className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            Owner <span className="mono" style={{ color: 'var(--subtle)' }}>{shortAddr(address)}</span>
          </button>
        ) : <ConnectKitButton />}
    </ConnectKitButton.Custom>
  )
}

export function Header({ view, onView }: { view: 'wallet' | 'settings'; onView: (v: 'wallet' | 'settings') => void }) {
  return (
    <header className="sticky top-0 z-20 border-b backdrop-blur-md" style={{ borderColor: 'var(--border)', background: 'rgba(0,0,0,0.85)' }}>
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
        <button onClick={() => onView('wallet')} className="flex items-center gap-2">
          <Shield size={16} style={{ color: 'var(--ink)' }} />
          <span className="display text-lg" style={{ color: 'var(--ink)' }}>Leash</span>
        </button>
        <NetworkSwitch />
        <div className="ml-auto flex items-center gap-2">
          <a href="https://studio.arc.io/" target="_blank" rel="noopener noreferrer" className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
            ◇ Built with Arc Studio
          </a>
          <button onClick={() => onView(view === 'settings' ? 'wallet' : 'settings')} title={view === 'settings' ? 'Back to wallet' : 'Settings'}
            className="w-9 h-9 flex items-center justify-center"
            style={{ background: view === 'settings' ? 'var(--ink)' : 'var(--surface)', color: view === 'settings' ? 'var(--bg)' : 'var(--ink)', border: '1px solid var(--border)' }}>
            <SettingsIcon size={16} />
          </button>
          <WalletChip />
        </div>
      </div>
    </header>
  )
}
