import { useEffect, useState } from 'react'
import { useAccount, useBalance, useDeployContract, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { isAddress } from 'viem'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { LEASH_ABI, LEASH_BYTECODE, displayToNative, shortAddr, walletErrorMessage } from '@/leash-contract'
import { useNetwork, rememberVault, addressUrl, txUrl } from '@/network'
import { useAgentLink } from '@/useAgentLink'

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20 } as const
const field = { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)', borderRadius: 12 } as const
const toNative = (s: string) => { try { return s ? displayToNative(s) : 0n } catch { return 0n } }
const clean = (v: string) => v.replace(/[^0-9.]/g, '')

/**
 * Deploys the Leash contract compiled and tested in Arc Studio, signed by the owner's own wallet: the owner is the
 * connected wallet, the agent is the MCP server's wallet, and an optional first deposit goes in with the deploy.
 */
export function DeployVault() {
  const { network } = useNetwork()
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { info } = useAgentLink()
  const { data: wallet } = useBalance({ address, chainId: network.chain.id, query: { enabled: !!address } })
  const { deployContractAsync, data: hash, isPending } = useDeployContract()
  const { data: receipt, isLoading: confirming } = useWaitForTransactionReceipt({ hash, chainId: network.chain.id })

  const [agent, setAgent] = useState('')
  const [daily, setDaily] = useState('1')
  const [each, setEach] = useState('0.25')
  const [deposit, setDeposit] = useState('1')
  const agentAddr = agent || info?.agent || ''
  const value = toNative(deposit)
  const balance = wallet?.value ?? 0n
  // Leave room for the deploy fee (well under $0.10 on Arc).
  const tooMuch = value > 0n && value + 10n ** 17n > balance
  const ready = !!address && isAddress(agentAddr) && toNative(daily) > 0n && toNative(each) > 0n && !tooMuch

  // Remember the new vault and reload, so every query starts from it.
  useEffect(() => {
    if (!receipt?.contractAddress) return
    rememberVault(network.id, receipt.contractAddress, receipt.blockNumber)
    toast.success(`Vault deployed on Arc ${network.label}`)
    setTimeout(() => location.reload(), 1200)
  }, [receipt, network.id, network.label])

  const deploy = async () => {
    try {
      if (chainId !== network.chain.id) await switchChainAsync({ chainId: network.chain.id })
      await deployContractAsync({
        abi: LEASH_ABI, bytecode: LEASH_BYTECODE, chainId: network.chain.id, value,
        args: [address, agentAddr, toNative(each), toNative(daily), 30n],
      })
    } catch (err) {
      toast.error(walletErrorMessage(err, 'Deploy was not sent'))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 py-6">
      <div className="text-center">
        <span className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-3" style={{ background: 'var(--surface-strong)', color: 'var(--ink)' }}><ShieldCheck size={22} /></span>
        <h1 className="display text-3xl" style={{ color: 'var(--ink)' }}>Deploy your vault on Arc {network.label}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--subtle)' }}>
          The same contract that runs on testnet, compiled and tested in Arc Studio. Your wallet signs the deploy, so you are the owner.
        </p>
      </div>

      {!address ? (
        <div className="flex items-center justify-between gap-3 p-5" style={card}>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>Connect the wallet that should own the vault.</span>
          <ConnectKitButton />
        </div>
      ) : (
        <div className="p-5 space-y-4" style={card}>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Owner (you)</div>
              <div className="mono" style={{ color: 'var(--ink)' }}>{shortAddr(address)}</div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Your USDC on Arc {network.label}</div>
              <div className="tabular-nums font-semibold" style={{ color: balance > 0n ? 'var(--ink)' : 'var(--blocked)' }}>{wallet ? Number(wallet.formatted).toFixed(2) : '—'} USDC</div>
            </div>
          </div>

          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Agent wallet · from your agent server{!info && ' (offline: paste it)'}</div>
            <input value={agentAddr} onChange={e => setAgent(e.target.value.trim())} placeholder="0x… agent address" className="w-full px-3 py-2 text-xs mono" style={field} />
          </div>

          <p className="text-base leading-10" style={{ color: 'var(--ink-2)' }}>
            Up to $<input value={daily} onChange={e => setDaily(clean(e.target.value))} inputMode="decimal" className="w-20 mx-1 px-2 py-1 text-center tabular-nums" style={field} /> a day,
            ${' '}<input value={each} onChange={e => setEach(clean(e.target.value))} inputMode="decimal" className="w-20 mx-1 px-2 py-1 text-center tabular-nums" style={field} /> per payment,
            and put ${' '}<input value={deposit} onChange={e => setDeposit(clean(e.target.value))} inputMode="decimal" className="w-20 mx-1 px-2 py-1 text-center tabular-nums" style={field} /> in now.
          </p>

          {balance === 0n && (
            <div className="text-sm p-3" style={{ background: 'var(--held-bg)', borderRadius: 12, color: 'var(--ink-2)' }}>
              This wallet has no USDC on Arc {network.label}. On Arc, fees are paid in USDC too, so you need some to deploy (about $0.10 covers it) plus whatever you want to put in the vault. Bring USDC onto Arc first (Arc’s CCTP bridge from another chain), then come back.
            </div>
          )}
          {tooMuch && balance > 0n && (
            <div className="text-xs" style={{ color: 'var(--blocked)' }}>That is more than your wallet holds once the deploy fee is set aside. Lower the first deposit.</div>
          )}

          <button disabled={!ready || isPending || confirming} onClick={deploy} className="w-full py-3 text-sm font-bold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            {isPending ? 'Confirm in your wallet…' : confirming ? 'Deploying on Arc…' : `Deploy vault on Arc ${network.label}`}
          </button>
          {hash && (
            <a href={txUrl(network, hash)} target="_blank" rel="noopener noreferrer" className="block text-center text-xs underline" style={{ color: 'var(--link)' }}>
              View the deploy transaction
            </a>
          )}
          {receipt?.contractAddress && (
            <div className="text-center text-xs" style={{ color: 'var(--paid)' }}>
              Vault <a className="underline mono" href={addressUrl(network, receipt.contractAddress)} target="_blank" rel="noopener noreferrer">{shortAddr(receipt.contractAddress)}</a> is live. Loading it…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
