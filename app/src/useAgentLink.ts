import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { AGENT_URL, agentHeaders, ownerSession, saveOwnerSession } from '@/agentServer'
import { walletErrorMessage } from '@/leash-contract'

// The agent server hands the link only to this app's origin, and when hosted only to the signed-in owner;
// the secret never ships in the bundle.
const LINK_ENDPOINT = `${AGENT_URL}/link`

export interface AgentLinkInfo {
  link: string | null
  on: boolean
  agent: string
  vault: string
  /** Hosted server: the link exists but is shown only after the owner signs in. */
  signin?: boolean
  /** The exact message to sign, with `<time>` to fill in. */
  message?: string | null
}

/** The agent link from the agent server: whether it is up, whether the link is on, and owner controls. */
export function useAgentLink() {
  const queryClient = useQueryClient()
  const { signMessageAsync } = useSignMessage()
  const { data, isError } = useQuery({
    queryKey: ['agent-link', ownerSession()],
    queryFn: async () => {
      const res = await fetch(LINK_ENDPOINT, { headers: agentHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      const info = (await res.json()) as AgentLinkInfo
      // An expired session reads as signed out.
      if (info.signin && ownerSession()) saveOwnerSession(null)
      return info
    },
    retry: false,
    refetchInterval: 15000,
  })

  /** Signs one message with the owner wallet; the server checks it against the vault's owner. */
  async function signIn() {
    if (!data?.message) return
    try {
      const time = new Date().toISOString()
      const signature = await signMessageAsync({ message: data.message.replace('<time>', time) })
      const res = await fetch(`${AGENT_URL}/session`, { method: 'POST', headers: agentHeaders(true), body: JSON.stringify({ time, signature }) })
      const body = (await res.json()) as { token?: string; error?: string }
      if (!res.ok || !body.token) throw new Error(body.error ?? 'Sign-in failed')
      saveOwnerSession(body.token)
      await queryClient.invalidateQueries({ queryKey: ['agent-link'] })
      toast.success('Signed in as the owner')
    } catch (err) {
      toast.error(walletErrorMessage(err, (err as Error).message || 'Sign-in failed'))
    }
  }

  async function control(action: 'rotate' | 'on' | 'off') {
    try {
      const res = await fetch(LINK_ENDPOINT, { method: 'POST', headers: agentHeaders(true), body: JSON.stringify({ action }) })
      if (res.status === 401) { toast.error('Sign in as the owner first (Connect your agent panel).'); return }
      if (!res.ok) throw new Error(String(res.status))
      queryClient.setQueryData(['agent-link', ownerSession()], await res.json())
      toast.success(action === 'rotate' ? 'New link made. The old one stopped working.' : action === 'off' ? 'Agent link turned off.' : 'Agent link turned on.')
    } catch {
      toast.error('The agent server did not answer. Is it running?')
    }
  }

  return { online: !!data && !isError, info: data, control, signIn }
}

export const maskLink = (link: string) => link.replace(/\/mcp\/.+$/, '/mcp/••••••••')

export function timeAgo(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
