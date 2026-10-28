import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// The local MCP server hands the link only to this app's origin; the secret never ships in the bundle.
const LINK_ENDPOINT = 'http://127.0.0.1:8787/link'

export interface AgentLinkInfo { link: string | null; on: boolean; agent: string; vault: string }

/** The agent link from the local MCP server: whether the server is up, whether the link is on, and owner controls. */
export function useAgentLink() {
  const queryClient = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ['agent-link'],
    queryFn: async () => {
      const res = await fetch(LINK_ENDPOINT)
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as AgentLinkInfo
    },
    retry: false,
    refetchInterval: 15000,
  })

  async function control(action: 'rotate' | 'on' | 'off') {
    try {
      const res = await fetch(LINK_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      if (!res.ok) throw new Error(String(res.status))
      queryClient.setQueryData(['agent-link'], await res.json())
      toast.success(action === 'rotate' ? 'New link made. The old one stopped working.' : action === 'off' ? 'Agent link turned off.' : 'Agent link turned on.')
    } catch {
      toast.error('The agent server did not answer. Is it running?')
    }
  }

  return { online: !!data && !isError, info: data, control }
}

export const maskLink = (link: string) => link.replace(/\/mcp\/.+$/, '/mcp/••••••••')

export function timeAgo(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
