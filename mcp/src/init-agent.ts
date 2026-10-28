// Creates the agent wallet and the secret MCP link token once, in .env next to package.json.
// Prints only the public address and the local link. The private key is never printed.
import { existsSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const ENV_PATH = new URL('../.env', import.meta.url)

if (existsSync(ENV_PATH)) {
  const env = Object.fromEntries(readFileSync(ENV_PATH, 'utf8').split('\n').filter(Boolean).map(l => l.split('=') as [string, string]))
  console.log('Agent wallet already exists.')
  console.log('Agent address:', privateKeyToAccount(env.AGENT_PRIVATE_KEY as `0x${string}`).address)
  process.exit(0)
}

const key = generatePrivateKey()
const token = randomBytes(24).toString('base64url')
writeFileSync(ENV_PATH, `AGENT_PRIVATE_KEY=${key}\nMCP_TOKEN=${token}\n`)
try { chmodSync(ENV_PATH, 0o600) } catch {}

console.log('Agent address:', privateKeyToAccount(key).address)
console.log('Saved the agent key and link token to mcp/.env (git-ignored). Testnet only.')
