import { parseAbi, type Abi } from 'viem'
import artifact from '../contracts/out/Leash.sol/Leash.json'

export const LEASH_ABI = artifact.abi as Abi
/** Creation bytecode compiled and tested in Arc Studio; the owner deploys it from their own wallet. */
export const LEASH_BYTECODE = artifact.bytecode.object as `0x${string}`
import { requireChain } from '@/onchain-facts'

export const LEASH_CHAIN_ID = 5042002 // Arc Testnet

export const LEASH_ADDRESS = '0xb9b3ca78cacdc85495997ee45919c5f4ffd81874' as const

export const LEASH = {
  address: LEASH_ADDRESS,
  abi: artifact.abi,
} as const

export const ARC_TESTNET = requireChain(LEASH_CHAIN_ID)

/** 18-decimal native units on Arc (USDC is the gas token). */
export const NATIVE_DECIMALS = 18

/** 6-decimal ERC-20 USDC decimals (for display). */
export const USDC_DISPLAY_DECIMALS = 6

/** Convert a 18-decimal native amount to a 6-decimal display string. */
export function nativeToDisplay(raw: bigint): string {
  if (raw === 0n) return '0.000000'
  const factor = 10n ** BigInt(NATIVE_DECIMALS - USDC_DISPLAY_DECIMALS) // 1e12
  const usdc6 = raw / factor
  const whole = usdc6 / 10n ** BigInt(USDC_DISPLAY_DECIMALS)
  const frac = usdc6 % 10n ** BigInt(USDC_DISPLAY_DECIMALS)
  return `${whole}.${frac.toString().padStart(USDC_DISPLAY_DECIMALS, '0')}`
}

/** Convert a dollar string like "0.02" to 18-decimal native bigint. */
export function displayToNative(usdcStr: string): bigint {
  const [whole = '0', frac = ''] = usdcStr.split('.')
  const fracPadded = frac.padEnd(USDC_DISPLAY_DECIMALS, '0').slice(0, USDC_DISPLAY_DECIMALS)
  const usdc6 = BigInt(whole) * 10n ** BigInt(USDC_DISPLAY_DECIMALS) + BigInt(fracPadded)
  const factor = 10n ** BigInt(NATIVE_DECIMALS - USDC_DISPLAY_DECIMALS)
  return usdc6 * factor
}

export interface LeashPolicy {
  agent: `0x${string}`
  perPaymentCap: bigint
  dailyCap: bigint
  maxPerHour: bigint
}

/** viem returns multi-output getters as a tuple, not an object: `policy()` -> [agent, perPaymentCap, dailyCap, maxPerHour]. */
export function readPolicy(raw: unknown): LeashPolicy | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined
  const [agent, perPaymentCap, dailyCap, maxPerHour] = raw as [`0x${string}`, bigint, bigint, bigint]
  return { agent, perPaymentCap, dailyCap, maxPerHour }
}

/** `autonomyRate()` -> [paidAlone, held, blocked]. Autonomy = paid alone out of paid + held; blocked is reported separately. */
export function readAutonomy(raw: unknown): { paidAlone: bigint; held: bigint; blocked: bigint; decided: bigint } {
  if (!Array.isArray(raw) || raw.length < 3) return { paidAlone: 0n, held: 0n, blocked: 0n, decided: 0n }
  const [paidAlone, held, blocked] = raw as [bigint, bigint, bigint]
  return { paidAlone, held, blocked, decided: paidAlone + held }
}

/** Event signatures, typed for viem's getContractEvents. */
export const LEASH_EVENTS = parseAbi([
  'event Paid(uint256 indexed id, address indexed payee, uint256 amount, string reason)',
  'event Held(uint256 indexed id, address indexed payee, uint256 amount, string reason, string ruleBroken)',
  'event Blocked(uint256 indexed id, address indexed payee, uint256 amount, string reason, string ruleBroken)',
  'event Approved(uint256 indexed id, address indexed payee, uint256 amount)',
  'event Denied(uint256 indexed id)',
  'event AllowlistUpdated(address indexed payee, bool allowed)',
  'event DenylistUpdated(address indexed payee, bool denied)',
  'event Deposited(address indexed owner, uint256 amount)',
  'event Withdrawn(address indexed owner, uint256 amount)',
])

/** Arc's predeployed Memo contract (same address on testnet and mainnet) and the event it emits. */
export const MEMO_ADDRESS = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as const
export const MEMO_EVENT = parseAbi([
  'event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)',
])

const RULE_WORDS: Record<string, string> = {
  per_payment_cap: 'more than the daily limit',
  payee_per_payment_cap: 'over this payee’s per-payment limit',
  payee_daily_cap: 'over this payee’s daily limit',
  daily_cap: 'over today’s limit',
  allowlist: 'not one of your payees',
  rate_limit: 'too many payments this hour',
  frozen: 'vault was frozen',
  denylist: 'payee is blocked',
  zero_payee: 'no payee',
  zero_amount: 'zero amount',
  insufficient_balance: 'vault balance too low',
}
export const ruleInWords = (rule: string | undefined) => (rule ? RULE_WORDS[rule] ?? rule : '')

/**
 * Wallet errors in plain words. "Rate limited" comes from the RPC saved in the user's wallet (MetaMask sends through
 * its own network settings, not this app's), so point at the fix rather than the contract.
 */
export function walletErrorMessage(err: unknown, fallback: string): string {
  const e = err as { shortMessage?: string; message?: string; details?: string }
  const text = `${e.shortMessage ?? ''} ${e.details ?? ''} ${e.message ?? ''}`
  if (/rate.?limit/i.test(text)) {
    return 'Your wallet’s Arc RPC is busy (rate limited). In MetaMask → Networks → Arc Testnet, set the RPC URL to https://rpc.drpc.testnet.arc.io and try again.'
  }
  if (/user (rejected|denied)/i.test(text)) return 'You cancelled it in your wallet.'
  return e.shortMessage ?? fallback
}

export function shortAddr(addr: string | undefined): string {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function buildExplorerTx(hash: string): string {
  return `${ARC_TESTNET.explorerBase}/tx/${hash}`
}

export function buildExplorerAddr(addr: string): string {
  return `${ARC_TESTNET.explorerBase}/address/${addr}`
}
