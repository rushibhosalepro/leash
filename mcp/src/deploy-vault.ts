// Deploys the Leash contract that Arc Studio compiled and tested (app/contracts/out) to Arc testnet.
// Signed by the agent wallet, but the OWNER is the address passed in, so the deployer gets no control.
// Usage: bun run src/deploy-vault.ts <owner> <dailyLimitUsdc> <initialDepositUsdc>
import { readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, fallback, parseUnits, isAddress, type Hex, type Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

const [owner, dailyArg = '1', depositArg = '0'] = process.argv.slice(2)
if (!owner || !isAddress(owner)) throw new Error('Usage: bun run src/deploy-vault.ts <owner 0x…> <daily limit USDC> <initial deposit USDC>')

const artifact = JSON.parse(readFileSync(new URL('../../app/contracts/out/Leash.sol/Leash.json', import.meta.url), 'utf8'))
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex)
const transport = fallback(arcTestnet.rpcUrls.default.http.map(url => http(url, { retryCount: 3, retryDelay: 500 })))
const pub = createPublicClient({ chain: arcTestnet, transport })
const wallet = createWalletClient({ chain: arcTestnet, transport, account })

const native = (usdc: string) => parseUnits(usdc, 18) // Arc's native USDC has 18 decimals
const daily = native(dailyArg)
// Simple model: one global daily limit. The vault-wide per-payment cap equals it, so it never adds a second rule;
// per-payment limits are set per payee. The hourly cap is kept high so it does not interfere.
const args = [owner, account.address, daily, daily, 30n] as const

const hash = await wallet.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode.object as Hex, args, value: native(depositArg) })
const receipt = await pub.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deploy failed: ${hash}`)

const record = {
  vault: receipt.contractAddress, block: receipt.blockNumber.toString(), tx: hash,
  owner, agent: account.address, daily_limit_usdc: dailyArg, initial_deposit_usdc: depositArg,
  explorer: `https://testnet.arcscan.app/address/${receipt.contractAddress}`,
}
writeFileSync(new URL('../deployment.json', import.meta.url), JSON.stringify(record, null, 2) + '\n')
console.log(JSON.stringify(record, null, 2))
