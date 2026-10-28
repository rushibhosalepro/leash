import { useState } from 'react'
import { toast } from 'sonner'
import { Bot, Copy, Eye, EyeOff } from 'lucide-react'
import { useAgentLink, maskLink, timeAgo } from '@/useAgentLink'
import { useAgentLog } from '@/useAgentLog'

type Client = 'claude-code' | 'cursor' | 'other'

const CLIENTS: { id: Client; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'other', label: 'Any MCP agent' },
]

function setupFor(client: Client, link: string): { step: string; snippet: string } {
  switch (client) {
    case 'claude-code':
      return { step: 'Run this in your terminal, then ask Claude to buy something.', snippet: `claude mcp add --transport http leash ${link}` }
    case 'cursor':
      return { step: 'Settings → MCP → Add new server, paste into mcp.json and save.', snippet: JSON.stringify({ mcpServers: { leash: { url: link } } }, null, 2) }
    case 'other':
      return { step: 'Add a Streamable HTTP MCP server with this URL.', snippet: link }
  }
}

export function ConnectAgent() {
  const [client, setClient] = useState<Client>('claude-code')
  const [revealed, setRevealed] = useState(false)
  const { online, info } = useAgentLink()
  const { lastUsedAt } = useAgentLog()
  const link = info?.link ?? null
  const shown = (l: string) => (revealed ? l : maskLink(l))
  const setup = link ? setupFor(client, link) : null

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  }

  const status = !online ? { dot: 'var(--subtle)', text: 'Agent server offline' }
    : !link ? { dot: 'var(--held)', text: 'Link turned off in Settings' }
      : { dot: 'var(--paid)', text: lastUsedAt ? `Agent connected · used ${timeAgo(lastUsedAt)}` : 'Ready · not used yet' }

  return (
    <aside id="connect-agent" className="p-5 space-y-4 lg:sticky lg:top-20"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20 }}>
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)', color: 'var(--ink)' }}><Bot size={18} /></span>
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>Connect your agent</h2>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.dot }} />{status.text}
          </div>
        </div>
      </div>

      {!online ? (
        <div className="p-3 text-sm" style={{ background: 'var(--surface-strong)', borderRadius: 14, color: 'var(--muted)' }}>
          Start the agent server in the <span className="mono">mcp</span> folder:
          <pre className="mono text-xs mt-2 p-2" style={{ background: 'var(--bg)', borderRadius: 10, color: 'var(--ink-2)' }}>bun run start</pre>
        </div>
      ) : !link ? (
        <div className="p-3 text-sm" style={{ background: 'var(--held-bg)', borderRadius: 14, color: 'var(--ink-2)' }}>
          The agent link is off, so no agent can pay. Turn it back on in Settings → Agent access.
        </div>
      ) : (
        <>
          <div>
            <div className="text-xs mb-1.5" style={{ color: 'var(--subtle)' }}>Your agent link</div>
            <div className="flex items-start gap-2 px-3 py-2.5 text-xs mono" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--ink-2)' }}>
              <span className={`flex-1 min-w-0 ${revealed ? 'break-all' : 'truncate'}`}>{shown(link).replace('http://', '')}</span>
              <button onClick={() => setRevealed(v => !v)} title={revealed ? 'Hide link' : 'Show full link'} className="shrink-0" style={{ color: 'var(--subtle)' }}>
                {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button onClick={() => copy(link, 'Agent link')} className="w-full mt-2 py-2.5 text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
              <Copy size={14} /> Copy link
            </button>
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--subtle)' }}>Keep it private. Anyone with it can spend inside your rules.</div>
          </div>

          <div>
            <div className="flex gap-1 mb-2 text-xs">
              {CLIENTS.map(c => (
                <button key={c.id} onClick={() => setClient(c.id)} className="px-3 py-1 font-semibold"
                  style={{ background: client === c.id ? 'var(--surface-strong)' : 'transparent', color: client === c.id ? 'var(--ink)' : 'var(--subtle)' }}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="text-sm mb-2" style={{ color: 'var(--ink-2)' }}>{setup!.step}</div>
            <div className="relative">
              <pre className="mono text-[11px] p-3 pr-10 whitespace-pre-wrap break-all" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--ink-2)' }}>
                {setup!.snippet.replace(link, shown(link))}
              </pre>
              <button onClick={() => copy(setup!.snippet, 'Setup')} className="absolute top-2 right-2 p-1.5" title="Copy with the full link"
                style={{ background: 'var(--surface-strong)', color: 'var(--muted)' }}>
                <Copy size={13} />
              </button>
            </div>
          </div>
        </>
      )}

      <div className="text-xs leading-relaxed space-y-1.5" style={{ color: 'var(--muted)' }}>
        <div><b style={{ color: 'var(--ink)' }}>Agent can:</b> pay with a reason on-chain, ask before paying, check its rules and what’s left today.</div>
        <div><b style={{ color: 'var(--ink)' }}>Agent can never:</b> raise its limits, add or unblock payees, unfreeze, approve itself, or withdraw. The contract refuses it.</div>
      </div>
    </aside>
  )
}
