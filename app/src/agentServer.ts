// Where the agent server (mcp/) runs: the local one by default, or the hosted one baked in at build time.
export const AGENT_URL = ((import.meta.env.VITE_AGENT_URL as string | undefined) ?? 'http://127.0.0.1:8787').replace(/\/$/, '')

// A hosted agent server shows the link and accepts changes only after the vault owner signs in.
// The session token lasts 12 hours and lives in this tab only.
const SESSION_KEY = 'leash.agent-session'

export function ownerSession(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY) } catch { return null }
}

export function saveOwnerSession(token: string | null) {
  try { token ? sessionStorage.setItem(SESSION_KEY, token) : sessionStorage.removeItem(SESSION_KEY) } catch { /* storage unavailable */ }
}

/** Headers for calls to the agent server, with the owner session when there is one. */
export function agentHeaders(json = false): Record<string, string> {
  const token = ownerSession()
  return { ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }
}
