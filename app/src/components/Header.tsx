import { ConnectKitButton } from 'connectkit'
import { Shield } from 'lucide-react'
import { NETWORKS, LIVE_NETWORKS, useNetwork } from '@/network'

function NetworkSwitch() {
  const { network, setNetwork } = useNetwork()

  // Only one network has a vault: just say which one we are on.
  if (LIVE_NETWORKS.length < 2) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: network.chain.testnet ? 'var(--held)' : 'var(--paid)' }} />
        {network.chain.name}
      </div>
    )
  }

  return (
    <div className="flex p-0.5 rounded-lg text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {LIVE_NETWORKS.map(id => (
        <button
          key={id}
          onClick={() => setNetwork(id)}
          className="px-2.5 py-1 rounded-md font-medium"
          style={{
            background: network.id === id ? 'var(--accent)' : 'transparent',
            color: network.id === id ? 'var(--on-accent)' : 'var(--muted)',
          }}
        >
          {NETWORKS[id].label}
        </button>
      ))}
    </div>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b backdrop-blur-md" style={{ borderColor: 'var(--border)', background: 'rgba(10,13,20,0.85)' }}>
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Shield size={16} style={{ color: 'var(--accent)' }} />
          <span className="display text-lg" style={{ color: 'var(--ink)' }}>Leash</span>
        </div>
        <NetworkSwitch />
        <div className="ml-auto">
          <ConnectKitButton />
        </div>
      </div>
    </header>
  )
}
