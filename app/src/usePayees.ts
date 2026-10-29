import { usePublicClient, useReadContracts } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LEASH_ABI, LEASH_EVENTS } from '@/leash-contract'
import { useNetwork } from '@/network'
import bundledPayees from '../../mcp/payees.json'

// Names live in the local MCP server's payees.json (the contract only knows addresses); it only answers this app's origin.
const PAYEES_ENDPOINT = 'http://127.0.0.1:8787/payees'
// The hosted site has no agent server, so it shows the names as they were when it was built.
const BUNDLED = bundledPayees as { name: string; address: `0x${string}` }[]

export type PayeeStatus = 'trusted' | 'allowed' | 'asks_first' | 'blocked'

export interface PayeeEntry {
  name: string | null
  address: `0x${string}`
  status: PayeeStatus
}

const lower = (a: string) => a.toLowerCase()

/** On-chain trusted / blocked lists. No getter exists, so rebuild from update events and keep what the contract still lists. */
function useOnchainList(kind: 'trusted' | 'blocked') {
  const { network } = useNetwork()
  const client = usePublicClient({ chainId: network.chain.id })
  const vault = network.vault
  const { data: candidates } = useQuery({
    queryKey: ['payees-onchain', kind, network.id, vault],
    enabled: !!vault && !!client,
    refetchInterval: 15000,
    queryFn: async () => {
      const logs = await client!.getContractEvents({
        address: vault!, abi: LEASH_EVENTS, eventName: kind === 'trusted' ? 'AllowlistUpdated' : 'DenylistUpdated', fromBlock: network.fromBlock, toBlock: 'latest',
      })
      return [...new Set(logs.map(l => (l.args as { payee: `0x${string}` }).payee))]
    },
  })
  const { data: flags } = useReadContracts({
    contracts: (candidates ?? []).map(p => ({
      address: vault ?? undefined, abi: LEASH_ABI, chainId: network.chain.id,
      functionName: kind === 'trusted' ? 'isAllowlisted' : 'isDenylisted', args: [p],
    })),
    query: { enabled: !!candidates?.length, refetchInterval: 15000 },
  })
  return (candidates ?? []).filter((_, i) => flags?.[i]?.result === true)
}

export function usePayeeDirectory() {
  return useQuery({
    queryKey: ['payee-directory'],
    retry: false,
    refetchInterval: 15000,
    queryFn: async () => {
      const res = await fetch(PAYEES_ENDPOINT)
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as { name: string; address: `0x${string}` }[]
    },
  })
}

/** Saved names merged with on-chain status. Addresses trusted or blocked on-chain but never named are included. */
export function usePayees(allowlistSize: bigint | undefined) {
  const directory = usePayeeDirectory()
  const trusted = useOnchainList('trusted')
  const blocked = useOnchainList('blocked')
  const trustedSet = new Set(trusted.map(lower)), blockedSet = new Set(blocked.map(lower))

  const status = (a: string): PayeeStatus =>
    blockedSet.has(lower(a)) ? 'blocked' : trustedSet.has(lower(a)) ? 'trusted' : !allowlistSize ? 'allowed' : 'asks_first'

  const saved = directory.data ?? BUNDLED
  const unnamed = [...new Set([...trusted, ...blocked])].filter(a => !saved.some(p => lower(p.address) === lower(a)))
  const entries: PayeeEntry[] = [
    ...saved.map(p => ({ name: p.name, address: p.address, status: status(p.address) })),
    ...unnamed.map(a => ({ name: null, address: a, status: status(a) })),
  ]
  const nameOf = (a: string) => saved.find(p => lower(p.address) === lower(a))?.name ?? null

  return { entries, nameOf, directoryOnline: !directory.isError && !!directory.data }
}

export function usePayeeEditor() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['payee-directory'] })

  async function save(name: string, address: string) {
    const res = await fetch(PAYEES_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, address }) })
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not save the payee')
    await refresh()
  }

  async function remove(address: string) {
    await fetch(`${PAYEES_ENDPOINT}?address=${address}`, { method: 'DELETE' })
    await refresh()
  }

  return { save, remove }
}
