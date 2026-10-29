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
    vault: '0xB9D96252a9cAB4CB97159cc395AF3C1597778580',
    fromBlock: 28505443n,
    explorer: 'https://explorer.arc.io',
  },
}

const STORAGE_KEY = 'leash.network'
const vaultKey = (id: NetworkId) => `leash.vault.${id}`

/**
 * A vault the owner deployed from this browser (the Deploy vault screen) is remembered here until its address is
 * added to NETWORKS above. Applied once at load, before anything reads NETWORKS.
 */
for (const id of Object.keys(NETWORKS) as NetworkId[]) {
  if (NETWORKS[id].vault) continue
  try {
    const saved = JSON.parse(localStorage.getItem(vaultKey(id)) ?? 'null') as { vault: `0x${string}`; fromBlock: string } | null
    if (saved?.vault) Object.assign(NETWORKS[id], { vault: saved.vault, fromBlock: BigInt(saved.fromBlock) })
  } catch { /* storage unavailable or malformed */ }
}

export function rememberVault(id: NetworkId, vault: `0x${string}`, fromBlock: bigint) {
  try { localStorage.setItem(vaultKey(id), JSON.stringify({ vault, fromBlock: fromBlock.toString() })) } catch { /* storage unavailable */ }
}

/** Networks with a deployed vault. */
export const LIVE_NETWORKS = (Object.keys(NETWORKS) as NetworkId[]).filter(id => NETWORKS[id].vault)

function initialNetwork(): NetworkId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'testnet' || saved === 'mainnet') return saved
  } catch { /* storage unavailable */ }
  // Real USDC first: open on mainnet whenever it has a vault.
  return NETWORKS.mainnet.vault ? 'mainnet' : LIVE_NETWORKS[0] ?? 'testnet'
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
