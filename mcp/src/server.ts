// Leash MCP server: gives any MCP agent a USDC spending account on Arc, inside the owner's rules.
// Local only for now: listens on 127.0.0.1 and answers only on the secret path /mcp/<MCP_TOKEN>.
import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { AGENT, VAULT, getRules, checkPayee, checkPayment, pay, noteOnPayment, paymentStatus, pendingForOwner, recentSpending, listPayeesWithStatus } from './leash'
import { recentAttempts } from './db'
import { listPayees, upsertPayee, removePayee, resolvePayee } from './payees'

const PORT = Number(process.env.MCP_PORT ?? 8787)
const TOKEN = process.env.MCP_TOKEN ?? ''
if (TOKEN.length < 24) throw new Error('MCP_TOKEN is missing from mcp/.env; run `bun run init-agent`')

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

// The web app reads the link from here to show it in its header. Only the local app origins may read it.
const APP_ORIGINS = (process.env.APP_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(',')
const LINK = `http://127.0.0.1:${PORT}/mcp/${TOKEN}`

// Endpoints for the web app (/link, /payees). Only the local app origins may call them; the agent never does.
async function appApi(req: Request, url: URL): Promise<Response> {
  const origin = req.headers.get('origin') ?? ''
  if (!APP_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 })
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  if (url.pathname === '/link') return Response.json({ link: LINK, agent: AGENT, vault: VAULT }, { headers })
  if (url.pathname === '/agent-log') return Response.json(recentAttempts(VAULT), { headers })

  try {
    if (req.method === 'GET') return Response.json(listPayees(), { headers })
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
  hostname: '127.0.0.1',
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (['/link', '/payees', '/agent-log'].includes(url.pathname)) return appApi(req, url)

    const [, prefix, token] = url.pathname.split('/')
    if (prefix !== 'mcp' || !token || !tokenMatches(token)) return new Response('Not found', { status: 404 })

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

console.log(`Leash MCP listening on 127.0.0.1:${PORT}`)
console.log(`Vault ${VAULT}, agent ${AGENT}`)
console.log('Agent link: shown in the web app header, or http://127.0.0.1:' + PORT + '/mcp/<MCP_TOKEN from mcp/.env>')
