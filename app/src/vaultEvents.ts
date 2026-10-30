// The vault's on-chain history. Arc's public RPCs cap eth_getLogs at a few thousand blocks and mainnet adds about
// two a second, so one query from the deploy block soon fails everywhere. Prefer the agent server's event index
// (one request); without it, scan in 4,000-block chunks and keep what was read, so later refreshes read only new blocks.
import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { hexToString, parseEventLogs, type PublicClient } from 'viem'
import { LEASH_EVENTS, MEMO_ADDRESS, MEMO_EVENT } from '@/leash-contract'
import { useNetwork } from '@/network'
import { AGENT_URL } from '@/agentServer'

export interface VaultEvent {
  name: string
  args: Record<string, unknown>
  block: bigint
  tx: `0x${string}`
  time: number | null
  memo: string | null
}

const CHUNK = 4_000n
const PARALLEL = 4
// Numeric event fields arrive from the server as strings; turn them back into bigints.
const BIGINT_ARGS = new Set(['id', 'amount', 'perPaymentCap', 'dailyCap'])

interface Scan { scannedTo: bigint; events: VaultEvent[]; memos: Map<string, string>; times: Map<bigint, number> }
const scans = new Map<string, Scan>()

async function fromServer(vault: string): Promise<VaultEvent[] | null> {
  try {
    const res = await fetch(`${AGENT_URL}/events`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { vault: string; events: (Omit<VaultEvent, 'block'> & { block: string })[] }
    // The hosted server indexes one vault; any other network or vault is scanned here instead.
    if (body.vault.toLowerCase() !== vault.toLowerCase()) return null
    return body.events.map(e => ({
      ...e,
      block: BigInt(e.block),
      args: Object.fromEntries(Object.entries(e.args).map(([k, v]) => [k, BIGINT_ARGS.has(k) && typeof v === 'string' ? BigInt(v) : v])),
    }))
  } catch {
    return null
  }
}

async function scanChain(client: PublicClient, vault: `0x${string}`, fromBlock: bigint): Promise<VaultEvent[]> {
  const key = `${client.chain?.id}:${vault.toLowerCase()}`
  const scan: Scan = scans.get(key) ?? { scannedTo: fromBlock - 1n, events: [], memos: new Map(), times: new Map() }
  scans.set(key, scan)
  const head = await client.getBlockNumber()
  const ranges: [bigint, bigint][] = []
  for (let from = scan.scannedTo + 1n; from <= head; from += CHUNK) ranges.push([from, from + CHUNK - 1n < head ? from + CHUNK - 1n : head])
  for (let i = 0; i < ranges.length; i += PARALLEL) {
    const batch = ranges.slice(i, i + PARALLEL)
    const results = await Promise.all(batch.map(([from, to]) => Promise.all([
      client.getLogs({ address: vault, fromBlock: from, toBlock: to }),
      client.getLogs({ address: MEMO_ADDRESS, event: MEMO_EVENT[0], args: { target: vault }, fromBlock: from, toBlock: to }),
    ])))
    for (const [logs, memos] of results) {
      for (const l of parseEventLogs({ abi: LEASH_EVENTS, logs })) {
        scan.events.push({ name: l.eventName, args: l.args as Record<string, unknown>, block: l.blockNumber, tx: l.transactionHash, time: null, memo: null })
      }
      for (const m of memos) scan.memos.set(m.transactionHash, hexToString(m.args.memo ?? '0x'))
    }
    scan.scannedTo = batch[batch.length - 1][1]
  }
  const missing = [...new Set(scan.events.map(e => e.block))].filter(b => !scan.times.has(b))
  await Promise.all(missing.map(async b => scan.times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp) * 1000)))
  return scan.events.map(e => ({ ...e, time: scan.times.get(e.block) ?? null, memo: scan.memos.get(e.tx) ?? null }))
}

/** Every event the vault emitted, oldest first, with block times and the agent's memo. Refreshes every 15 s. */
export function useVaultEvents() {
  const { network } = useNetwork()
  const client = usePublicClient({ chainId: network.chain.id })
  const vault = network.vault
  return useQuery({
    queryKey: ['vault-events', network.id, vault],
    enabled: !!vault && !!client,
    refetchInterval: 15_000,
    queryFn: async () => (await fromServer(vault!)) ?? scanChain(client as PublicClient, vault!, network.fromBlock),
  })
}
