import { createContext, useContext, useState, type ReactNode } from 'react'
import { arc, arcTestnet } from 'viem/chains'
import type { Chain } from 'viem'

export type NetworkId = 'testnet' | 'mainnet'

export interface Network {
  id: NetworkId
  label: string
  chain: Chain
  /** null until a Leash vault is deployed on this network. */
  vault: `0x${string}` | null
  /** Block the vault was deployed in; event queries start here. */
  fromBlock: bigint
  explorer: string
}

export const NETWORKS: Record<NetworkId, Network> = {
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    chain: arcTestnet,
    vault: '0x923aa72a2ff76f91358ffc5a87b5afb202beeca1',
    fromBlock: 69432747n,
    explorer: 'https://testnet.arcscan.app',
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    chain: arc,
    vault: null,
    fromBlock: 0n,
    explorer: 'https://explorer.arc.io',
  },
}

const STORAGE_KEY = 'leash.network'

/** Networks with a deployed vault. The UI only offers these. */
export const LIVE_NETWORKS = (Object.keys(NETWORKS) as NetworkId[]).filter(id => NETWORKS[id].vault)

function initialNetwork(): NetworkId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if ((saved === 'testnet' || saved === 'mainnet') && LIVE_NETWORKS.includes(saved)) return saved
  } catch { /* storage unavailable */ }
  return LIVE_NETWORKS[0] ?? 'testnet'
}

const NetworkContext = createContext<{ network: Network; setNetwork: (id: NetworkId) => void } | null>(null)

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<NetworkId>(initialNetwork)
  const setNetwork = (next: NetworkId) => {
    setId(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* storage unavailable */ }
  }
  return <NetworkContext.Provider value={{ network: NETWORKS[id], setNetwork }}>{children}</NetworkContext.Provider>
}

export function useNetwork() {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used inside NetworkProvider')
  return ctx
}

export const txUrl = (net: Network, hash: string) => `${net.explorer}/tx/${hash}`
export const addressUrl = (net: Network, addr: string) => `${net.explorer}/address/${addr}`
