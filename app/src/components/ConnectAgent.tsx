import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Check, X, Eye, EyeOff } from 'lucide-react'

// The local MCP server hands the link only to this app's origin; the secret never ships in the bundle.
const LINK_ENDPOINT = 'http://127.0.0.1:8787/link'

type Client = 'claude-code' | 'cursor' | 'other'

const CLIENTS: { id: Client; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'other', label: 'Any MCP agent' },
]

function setupFor(client: Client, link: string): { steps: string[]; snippet: string } {
  switch (client) {
    case 'claude-code':
      return { steps: ['Run this in your terminal.', 'Ask Claude to buy something.'], snippet: `claude mcp add --transport http leash ${link}` }
    case 'cursor':
      return {
        steps: ['Open Settings → MCP → Add new server.', 'Paste this into mcp.json and save.'],
        snippet: JSON.stringify({ mcpServers: { leash: { url: link } } }, null, 2),
      }
    case 'other':
      return { steps: ['Add a Streamable HTTP MCP server with this URL.'], snippet: link }
  }
}

const CAN = ['Pay in USDC, with its reason written on-chain', 'Ask first: would this be paid, held or blocked?', 'Read all its rules and what is left today', 'See its spending and follow up on held payments']
const CANNOT = ['Raise its own limits', 'Trust or unblock a payee', 'Unfreeze the vault', 'Approve its own held payments', 'Withdraw the vault']

export function ConnectAgent() {
  const [client, setClient] = useState<Client>('claude-code')
  const [revealed, setRevealed] = useState(false)
  const { data, isError } = useQuery({
    queryKey: ['agent-link'],
    queryFn: async () => {
      const res = await fetch(LINK_ENDPOINT)
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as { link: string; agent: string }
    },
    retry: false,
    refetchInterval: 15000,
  })

  const online = !!data && !isError
  const setup = online ? setupFor(client, data.link) : null
  const hide = (link: string) => (revealed ? link : link.replace(/\/mcp\/.+$/, '/mcp/••••••••'))
  const masked = online ? hide(data.link).replace('http://', '') : ''

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  }

  return (
    <aside className="rounded-2xl p-5 space-y-5 lg:sticky lg:top-20" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: online ? 'var(--paid)' : 'var(--subtle)' }} />
          <h2 className="display text-xl" style={{ color: 'var(--ink)' }}>Connect your agent</h2>
        </div>
        <p className="text-sm mt-1" style={{ color: 'var(--subtle)' }}>
          Paste this link into your AI agent. It can then pay in USDC, always inside your rules.
        </p>
      </div>

      {!online ? (
        <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--surface-strong)', color: 'var(--muted)' }}>
          The agent server is not running. Start it in the <span className="mono">mcp</span> folder:
          <pre className="mono text-xs mt-2 p-2 rounded-md" style={{ background: 'var(--bg)', color: 'var(--ink-2)' }}>bun run start</pre>
        </div>
      ) : (
        <>
          <div>
            <div className="text-xs mb-1.5" style={{ color: 'var(--subtle)' }}>Your agent link</div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0 flex items-start gap-2 px-3 py-2 rounded-lg text-xs mono" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                <span className={`flex-1 min-w-0 ${revealed ? 'break-all' : 'truncate'}`}>{masked}</span>
                <button onClick={() => setRevealed(v => !v)} title={revealed ? 'Hide link' : 'Show full link'}
                  className="shrink-0" style={{ color: 'var(--subtle)' }}>
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button onClick={() => copy(data.link, 'Agent link')} className="px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                <Copy size={13} /> Copy
              </button>
            </div>
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--subtle)' }}>Works on this computer only. Keep it private.</div>
          </div>

          <div>
            <div className="flex gap-1 mb-3 text-xs">
              {CLIENTS.map(c => (
                <button key={c.id} onClick={() => setClient(c.id)} className="px-2.5 py-1 rounded-md font-medium"
                  style={{ background: client === c.id ? 'var(--surface-strong)' : 'transparent', color: client === c.id ? 'var(--ink)' : 'var(--subtle)' }}>
                  {c.label}
                </button>
              ))}
            </div>
            <ol className="space-y-1 text-sm list-decimal list-inside" style={{ color: 'var(--muted)' }}>
              {setup!.steps.map(s => <li key={s}>{s}</li>)}
            </ol>
            <div className="relative mt-2">
              <pre className="mono text-[11px] p-3 pr-10 rounded-lg whitespace-pre-wrap break-all" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                {setup!.snippet.replace(data.link, hide(data.link))}
              </pre>
              <button onClick={() => copy(setup!.snippet, 'Setup')} className="absolute top-2 right-2 p-1.5 rounded-md" title="Copy with the full link"
                style={{ background: 'var(--surface-strong)', color: 'var(--muted)' }}>
                <Copy size={13} />
              </button>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 pt-1">
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--ink)' }}>Your agent can</div>
          <ul className="space-y-1.5">
            {CAN.map(t => (
              <li key={t} className="flex gap-2 text-xs" style={{ color: 'var(--muted)' }}><Check size={14} style={{ color: 'var(--paid)', flexShrink: 0 }} />{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--ink)' }}>Your agent can never</div>
          <ul className="space-y-1.5">
            {CANNOT.map(t => (
              <li key={t} className="flex gap-2 text-xs" style={{ color: 'var(--muted)' }}><X size={14} style={{ color: 'var(--blocked)', flexShrink: 0 }} />{t}</li>
            ))}
          </ul>
          <div className="text-[11px] mt-2" style={{ color: 'var(--subtle)' }}>Only your wallet can do these. The smart contract refuses the agent, whatever it is told.</div>
        </div>
      </div>
    </aside>
  )
}
