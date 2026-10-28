// Names for the apps and people the agent pays. The contract only knows addresses, so names live
// in a local file shared by the web app and the agent. Trusted / blocked status stays on-chain.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAddress, getAddress, type Hex } from 'viem'

export interface Payee { name: string; address: Hex }

const FILE = new URL('../payees.json', import.meta.url)

export function listPayees(): Payee[] {
  if (!existsSync(FILE)) return []
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Payee[]
  } catch {
    return []
  }
}

function save(list: Payee[]) {
  writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n')
}

export function upsertPayee(name: string, address: string): Payee {
  const clean = name.trim()
  if (!clean || clean.length > 60) throw new Error('Name must be 1–60 characters')
  if (!isAddress(address)) throw new Error('Not a valid 0x address')
  const payee = { name: clean, address: getAddress(address) }
  const others = listPayees().filter(p =>
    p.address.toLowerCase() !== payee.address.toLowerCase() && p.name.toLowerCase() !== clean.toLowerCase())
  save([...others, payee].sort((a, b) => a.name.localeCompare(b.name)))
  return payee
}

export function removePayee(address: string) {
  save(listPayees().filter(p => p.address.toLowerCase() !== address.toLowerCase()))
}

export const nameOf = (address: string) =>
  listPayees().find(p => p.address.toLowerCase() === address.toLowerCase())?.name ?? null

/** Lets the agent say "Weather API" instead of an address. Exact name match, case-insensitive. */
export function resolvePayee(nameOrAddress: string): Hex {
  if (isAddress(nameOrAddress)) return getAddress(nameOrAddress)
  const hit = listPayees().find(p => p.name.toLowerCase() === nameOrAddress.trim().toLowerCase())
  if (!hit) throw new Error(`No payee named "${nameOrAddress}". Call leash_list_payees to see saved payees, or use a 0x address.`)
  return hit.address
}
