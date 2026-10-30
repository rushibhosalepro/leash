// Leash MCP server: gives any MCP agent a USDC spending account on Arc, inside the owner's rules.
// Answers agents only on the secret path /mcp/<MCP_TOKEN>. Runs on 127.0.0.1 by default; with MCP_HOST=0.0.0.0
// (hosted), the link and every setting are shown only to the vault owner after a wallet signature.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { verifyMessage, type Hex } from 'viem'
import { z } from 'zod'
import { AGENT, VAULT, ON_MAINNET, vaultOwner, getRules, checkPayee, checkPayment, pay, noteOnPayment, paymentStatus, pendingForOwner, recentSpending, listPayeesWithStatus } from './leash'
import { recentAttempts } from './db'
import { listPayees, upsertPayee, removePayee, resolvePayee } from './payees'

// Hosts like Render pass the port in PORT.
const PORT = Number(process.env.PORT ?? process.env.MCP_PORT ?? 8787)
const HOST = process.env.MCP_HOST ?? '127.0.0.1'
// The address agents use to reach this server; on a host, its public https URL.
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '')
// Anyone can reach a hosted server, so there the owner must sign in with the vault owner's wallet.
const OWNER_SIGNIN = HOST !== '127.0.0.1'
let TOKEN = process.env.MCP_TOKEN ?? ''
if (TOKEN.length < 24) throw new Error('MCP_TOKEN is missing from mcp/.env; run `bun run init-agent`')
// The owner can turn the link off from the web app; while off, the MCP endpoint answers 404.
let LINK_ON = process.env.LINK_ENABLED !== 'false'

/** Writes one KEY=value line in mcp/.env, so link changes survive a restart. Never logs the value. A host without the file keeps it in memory only. */
function saveEnv(key: string, value: string) {
  const path = new URL('../.env', import.meta.url)
  if (!existsSync(path)) return
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l && !l.startsWith(`${key}=`))
  writeFileSync(path, [...lines, `${key}=${value}`].join('\n') + '\n')
}

// Owner sessions: the app signs one message with the owner wallet and gets a 12-hour token back.
// The key is per process, so a restart signs everyone out.
const SESSION_KEY = randomBytes(32)
const SESSION_MS = 12 * 60 * 60 * 1000
const sessionMac = (expires: number) => createHmac('sha256', SESSION_KEY).update(`${VAULT}:${expires}`).digest('base64url')
const signInMessage = (time: string) => `Sign in to Leash as the vault owner.\nVault: ${VAULT}\nTime: ${time}`

function hasOwnerSession(req: Request) {
  if (!OWNER_SIGNIN) return true
  const [expires, mac] = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '').split('.')
  if (!expires || !mac || Number(expires) < Date.now()) return false
  const a = Buffer.from(mac), b = Buffer.from(sessionMac(Number(expires)))
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Checks a fresh signature from the vault owner and returns a session token, or null. */
async function signIn(body: { time?: string; signature?: Hex }) {
  const time = body.time ?? ''
  const age = Date.now() - Date.parse(time)
  if (!body.signature || !(age >= -60_000 && age < 10 * 60_000)) return null
  const owner = await vaultOwner()
  const ok = await verifyMessage({ address: owner, message: signInMessage(time), signature: body.signature }).catch(() => false)
  if (!ok) return null
  const expires = Date.now() + SESSION_MS
  return `${expires}.${sessionMac(expires)}`
}

const payeeRef = z.string().min(1).max(60).describe('A saved payee name (e.g. "Weather API") or a 0x address')
const usdc = z.string().regex(/^\d+(\.\d{1,6})?$/, 'a USDC amount like "0.02"')
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

function buildServer() {
  const server = new McpServer(
    { name: 'leash', version: '0.1.0' },
    {
      instructions: 'Leash is a USDC spending account on Arc whose rules are set by a human owner and enforced by a smart contract. ' +
        'You can read every rule and pay inside them. You cannot change, raise, bypass or request changes to the rules through these tools; ' +
        'payments outside them are held for the owner or blocked. Read leash_get_rules before planning purchases, and use leash_check_payment before paying.',
    },
  )

  server.registerTool('leash_get_rules', {
    title: 'Read all my spending rules',
    description: 'Every rule on your Leash vault, read live from the contract: per-payment limit, daily limit and what is left today, max payments per hour and how many you used in the last hour, trusted payees, blocked payees, whether the vault is frozen, its balance, and how many payments wait for the owner. Read-only: you cannot change any of these.',
    annotations: { readOnlyHint: true },
  }, async () => json(await getRules()))

  server.registerTool('leash_list_payees', {
    title: 'List my payees',
    description: 'The apps and people the owner saved, by name and address, each marked trusted (paid without asking, within limits), allowed (no trusted list is set, so limits alone decide), asks_first (held for the owner), or blocked. Use these names in leash_pay. Read-only: only the owner can add, trust or block payees.',
    annotations: { readOnlyHint: true },
  }, async () => json(await listPayeesWithStatus()))

  server.registerTool('leash_check_payee', {
    title: 'Look up a payee',
    description: 'Whether a payee (by saved name or address) is trusted, blocked, or not yet trusted (payments to it would wait for the owner). Read-only.',
    inputSchema: { payee: payeeRef },
    annotations: { readOnlyHint: true },
  }, async ({ payee }) => json(await checkPayee(resolvePayee(payee))))

  server.registerTool('leash_get_pending', {
    title: 'Payments waiting for the owner',
    description: 'Your payments that are held until the owner approves or denies them, with the rule that held each one. Read-only: only the owner can approve.',
    annotations: { readOnlyHint: true },
  }, async () => json(await pendingForOwner()))

  server.registerTool('leash_check_payment', {
    title: 'Ask before paying',
    description: 'Preview a payment without sending it. Returns whether it would be paid now, held until the owner approves, or blocked, and which rule decided. Uses the same on-chain rule check as a real payment.',
    inputSchema: { payee: payeeRef, amount_usdc: usdc },
    annotations: { readOnlyHint: true },
  }, async ({ payee, amount_usdc }) => json(await checkPayment(resolvePayee(payee), amount_usdc)))

  server.registerTool('leash_pay', {
    title: 'Pay in USDC',
    description: 'Pay someone in USDC from the Leash vault. Always give a short, honest reason; it is written on-chain with the payment. If the payment is outside your rules it is NOT sent: it is held for the owner (tell the user it is waiting for approval) or blocked. You cannot change your own limits.',
    inputSchema: {
      payee: payeeRef,
      amount_usdc: usdc,
      reason: z.string().min(3).max(200).describe('Short reason, written on-chain with the payment'),
      note: z.string().max(2000).optional().describe('Optional longer note for the owner (context, what was bought, links). Kept in the local agent log, not on-chain.'),
    },
    annotations: { destructiveHint: true, idempotentHint: false },
  }, async ({ payee, amount_usdc, reason, note }) => json(await pay(resolvePayee(payee), amount_usdc, reason, note)))

  server.registerTool('leash_add_note', {
    title: 'Add a note to a payment',
    description: 'Attach a note to one of your earlier payments, for example what was received or why it was needed. Find it by payment_id, transaction hash, or the log_id returned by leash_pay. Notes are kept in the local agent log, not on-chain.',
    inputSchema: { payment: z.string().min(1).max(80), note: z.string().min(1).max(2000) },
  }, async ({ payment, note }) => json(noteOnPayment(payment, note)))

  server.registerTool('leash_payment_status', {
    title: 'Follow up on a payment',
    description: 'Status of a payment by its payment_id: paid, waiting_for_owner, approved_by_owner_and_paid, denied_by_owner, or blocked.',
    inputSchema: { payment_id: z.string().regex(/^\d+$/) },
    annotations: { readOnlyHint: true },
  }, async ({ payment_id }) => json(await paymentStatus(payment_id)))

  server.registerTool('leash_get_spending', {
    title: 'See my spending',
    description: 'What is left today, your most recent payments with their outcome, reason, notes and explorer link, and your failed attempts with the error.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => json(await recentSpending(limit)))

  return server
}

function tokenMatches(candidate: string) {
  const a = Buffer.from(candidate), b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

// The web app reads the link from here to show it to the owner. Only the app's own origins may call these.
const APP_ORIGINS = (process.env.APP_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(',')
const link = () => `${PUBLIC_URL}/mcp/${TOKEN}`
const linkInfo = (owner: boolean) => ({
  link: LINK_ON && owner ? link() : null, on: LINK_ON, agent: AGENT, vault: VAULT, network: ON_MAINNET ? 'mainnet' : 'testnet',
  // true: the link exists but is shown only after the owner signs in.
  signin: !owner, message: OWNER_SIGNIN ? signInMessage('<time>') : null,
})

// Endpoints for the web app (/link, /payees, /agent-log, /session); the agent never calls them.
// Reading payee names and the agent log is public. The link and every change need the owner.
async function appApi(req: Request, url: URL): Promise<Response> {
  const origin = req.headers.get('origin') ?? ''
  if (!APP_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 })
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const owner = hasOwnerSession(req)
  const ownerOnly = () => Response.json({ error: 'Sign in with the vault owner wallet first' }, { status: 401, headers })

  if (url.pathname === '/session' && req.method === 'POST') {
    const token = await signIn((await req.json()) as { time?: string; signature?: Hex })
    return token ? Response.json({ token, expires_in_ms: SESSION_MS }, { headers }) : Response.json({ error: 'That signature is not from the vault owner, or it is too old' }, { status: 401, headers })
  }

  if (url.pathname === '/link') {
    if (req.method === 'POST') {
      if (!owner) return ownerOnly()
      const { action } = (await req.json()) as { action?: 'rotate' | 'on' | 'off' }
      if (action === 'rotate') {
        // A new secret: the old link stops working immediately.
        TOKEN = randomBytes(24).toString('base64url')
        saveEnv('MCP_TOKEN', TOKEN)
      } else if (action === 'on' || action === 'off') {
        LINK_ON = action === 'on'
        saveEnv('LINK_ENABLED', String(LINK_ON))
      }
    }
    return Response.json(linkInfo(owner), { headers })
  }
  if (url.pathname === '/agent-log') return Response.json(recentAttempts(VAULT), { headers })

  try {
    if (req.method === 'GET') return Response.json(listPayees(), { headers })
    if (!owner) return ownerOnly()
    if (req.method === 'POST') {
      const { name, address } = (await req.json()) as { name?: string; address?: string }
      return Response.json(upsertPayee(name ?? '', address ?? ''), { headers })
    }
    if (req.method === 'DELETE') {
      removePayee(url.searchParams.get('address') ?? '')
      return new Response(null, { status: 204, headers })
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400, headers })
  }
  return new Response('Method not allowed', { status: 405, headers })
}

Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    // Health check for the host. Says nothing about the link.
    if (url.pathname === '/' || url.pathname === '/health') return new Response('ok')
    if (['/link', '/payees', '/agent-log', '/session'].includes(url.pathname)) return appApi(req, url)

    const [, prefix, token] = url.pathname.split('/')
    if (!LINK_ON || prefix !== 'mcp' || !token || !tokenMatches(token)) return new Response('Not found', { status: 404 })

    // Stateless: a fresh server and transport per request, so nothing is shared between clients.
    const server = buildServer()
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(req)
    } finally {
      void transport.close(); void server.close()
    }
  },
})

console.log(`Leash MCP listening on ${HOST}:${PORT}${OWNER_SIGNIN ? ' (hosted: owner signs in to see the link)' : ''}`)
console.log(`${ON_MAINNET ? 'Arc MAINNET' : 'Arc testnet'} · vault ${VAULT} · agent ${AGENT}`)
console.log(`Agent link: shown in the web app, or ${PUBLIC_URL}/mcp/<MCP_TOKEN>`)
