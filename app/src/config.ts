/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, arc, mainnet], // Ethereum mainnet needed for ENS resolution
  connectors: [injected()],
  batch: { multicall: true },
  transports: {
    // The public Arc RPC returns 429 under the ledger's polling: batch reads, back off on retry,
    // and fall through the other public Arc endpoints viem lists.
    [arcTestnet.id]: fallback(
      arcTestnet.rpcUrls.default.http.map(url => http(url, { batch: { wait: 50 }, retryCount: 3, retryDelay: 400 })),
    ),
    [arc.id]: fallback(arc.rpcUrls.default.http.map(url => http(url, { batch: { wait: 50 }, retryCount: 3, retryDelay: 400 }))),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
