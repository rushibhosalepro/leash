import { useQuery } from '@tanstack/react-query'
import { useNetwork } from '@/network'
import { AGENT_URL } from '@/agentServer'

// The local MCP server's agent log (Bun SQLite): notes the agent attached, and attempts that never produced a
// contract event (refused before sending, or reverted). Only this app's origins may read it.
const LOG_ENDPOINT = `${AGENT_URL}/agent-log`

export interface AgentAttempt {
  id: number
  vault: string
  payee: `0x${string}`
  payee_name: string | null
  amount_usdc: string
  reason: string
  outcome: 'paid' | 'held' | 'blocked' | 'failed' | string
  payment_id: string | null
  tx_hash: string | null
  error: string | null
  created_at: string
  notes: { note: string; at: string }[]
}

export function useAgentLog() {
  const { network } = useNetwork()
  const { data } = useQuery({
    queryKey: ['agent-log'],
    retry: false,
    refetchInterval: 15000,
    queryFn: async () => {
      const res = await fetch(LOG_ENDPOINT)
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as AgentAttempt[]
    },
  })
  const forVault = (data ?? []).filter(a => network.vault && a.vault.toLowerCase() === network.vault.toLowerCase())
  const notesByTx = new Map(forVault.filter(a => a.tx_hash && a.notes.length).map(a => [a.tx_hash!.toLowerCase(), a.notes]))
  const lastUsedAt = forVault.length ? Math.max(...forVault.map(a => Date.parse(a.created_at))) : null
  return {
    notesFor: (tx: string) => notesByTx.get(tx.toLowerCase()) ?? [],
    failed: forVault.filter(a => a.outcome === 'failed'),
    lastUsedAt,
  }
}
