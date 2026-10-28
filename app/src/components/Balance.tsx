import { useState } from 'react'
import { useAccount, useBalance, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'
import { ConnectKitButton } from 'connectkit'
import { Info } from 'lucide-react'
import { displayToNative, nativeToDisplay, shortAddr, walletErrorMessage } from '@/leash-contract'
import { useNetwork } from '@/network'
import { useVault, useVaultWrite } from '@/useVault'

const fmt = (v: bigint | undefined) => (v === undefined ? '—' : Number(nativeToDisplay(v)).toFixed(2))

export function Balance({ onOpenRules }: { onOpenRules?: () => void }) {
  const { network } = useNetwork()
  const { address } = useAccount()
  const { balance, remainingToday, policy, isOwner, owner, frozen } = useVault()
  const { write, busy } = useVaultWrite()
  const { data: walletBalance } = useBalance({ address, chainId: network.chain.id, query: { enabled: !!address && isOwner } })
  const { data: agentGas } = useBalance({ address: policy?.agent, chainId: network.chain.id, query: { enabled: !!policy?.agent, refetchInterval: 15000 } })
  const [amount, setAmount] = useState('')

  const value = (() => { try { return amount ? displayToNative(amount) : 0n } catch { return 0n } })()
  const run = async (fn: 'deposit' | 'withdraw') => {
    await (fn === 'deposit' ? write('deposit', [], value) : write('withdraw', [value]))
    setAmount('')
  }
  const lowGas = agentGas !== undefined && agentGas.value < 5n * 10n ** 16n // under 0.05 USDC, about ten agent payments

  return (
    <section className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>Vault balance</div>
          <div className="display text-4xl tabular-nums" style={{ color: 'var(--ink)' }}>
            {fmt(balance)} <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        </div>
        <div>
          <div className="text-xs flex items-center gap-1" style={{ color: 'var(--subtle)' }}>
            Agent’s daily limit
            <span className="relative group inline-flex">
              <Info size={13} className="cursor-help" style={{ color: 'var(--muted)' }} />
              <span className="pointer-events-none group-hover:pointer-events-auto absolute left-1/2 top-5 z-30 w-64 -translate-x-1/2 rounded-xl p-3 text-xs leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', color: 'var(--ink-2)' }}>
                The most your agent can spend in total today. It resets every 24 hours. Anything over it waits for your approval.
                {onOpenRules && <> <button onClick={onOpenRules} className="underline" style={{ color: 'var(--link)' }}>Change it in Rules</button>.</>}
              </span>
            </span>
          </div>
          <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
            ${fmt(remainingToday)} <span className="text-sm font-normal" style={{ color: 'var(--subtle)' }}>left of ${fmt(policy?.dailyCap)} today</span>
          </div>
          {onOpenRules && (
            <button onClick={onOpenRules} className="text-xs mt-0.5 hover:underline" style={{ color: 'var(--link)' }}>Change daily limit →</button>
          )}
        </div>
        {frozen && <div className="text-xs font-semibold px-2 py-1 rounded-md" style={{ color: 'var(--blocked)', background: 'var(--blocked-bg)' }}>Frozen</div>}
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        {isOwner ? (
          <>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center rounded-lg px-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--subtle)' }}>$</span>
                <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal"
                  className="flex-1 bg-transparent px-2 py-2 text-sm outline-none tabular-nums" style={{ color: 'var(--ink)' }} />
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
              </div>
              <button disabled={busy || value === 0n} onClick={() => run('deposit')} className="px-4 rounded-lg text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Deposit</button>
              <button disabled={busy || value === 0n} onClick={() => run('withdraw')} className="px-4 rounded-lg text-sm font-semibold disabled:opacity-40"
                style={{ border: '1px solid var(--border-strong)', color: 'var(--muted)' }}>Withdraw</button>
            </div>
            <div className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>
              Your wallet: {walletBalance ? Number(walletBalance.formatted).toFixed(2) : '—'} USDC. Deposits come from your wallet; only you can withdraw.
            </div>
          </>
        ) : address ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>
            Only the owner {owner && <span className="mono">{shortAddr(owner)}</span>} can deposit or withdraw. Switch to that wallet.
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--muted)' }}>
            Connect the owner wallet to deposit or withdraw.
            <ConnectKitButton />
          </div>
        )}
        {lowGas && (
          <div className="text-xs mt-2" style={{ color: 'var(--held)' }}>
            The agent wallet <span className="mono">{shortAddr(policy?.agent)}</span> has {Number(agentGas!.formatted).toFixed(3)} USDC for network fees. Top it up so it can pay.
          </div>
        )}
        {lowGas && address && policy?.agent && <TopUpAgent agent={policy.agent} balance={agentGas?.formatted} />}
      </div>
    </section>
  )
}

/** Sends USDC from the connected wallet to the agent wallet, on the right chain, so the agent can pay network fees. */
function TopUpAgent({ agent, balance }: { agent: `0x${string}`; balance?: string }) {
  const { network } = useNetwork()
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync, data: hash, isPending } = useSendTransaction()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash, chainId: network.chain.id })
  const [amount, setAmount] = useState('0.10')
  const value = (() => { try { return amount ? displayToNative(amount) : 0n } catch { return 0n } })()

  const send = async () => {
    try {
      if (chainId !== network.chain.id) await switchChainAsync({ chainId: network.chain.id })
      await sendTransactionAsync({ to: agent, value, chainId: network.chain.id })
    } catch (err) {
      toast.error(walletErrorMessage(err, 'Not sent'))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
      <span>Agent wallet <span className="mono">{shortAddr(agent)}</span> · {balance ? Number(balance).toFixed(3) : '—'} USDC for fees.</span>
      <span className="ml-auto flex items-center gap-1">
        Top up $<input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal"
          className="w-16 px-2 py-1 rounded-md text-center tabular-nums" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
        <button disabled={isPending || confirming || value === 0n} onClick={send} className="px-2.5 py-1 rounded-md font-semibold disabled:opacity-40"
          style={{ border: '1px solid var(--border-strong)', color: 'var(--ink-2)' }}>
          {isPending ? 'Confirm in wallet…' : confirming ? 'Sending…' : 'Send'}
        </button>
      </span>
      {isSuccess && hash && <span className="w-full" style={{ color: 'var(--paid)' }}>Sent. <a className="underline" href={`${network.explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer">View on explorer</a></span>}
    </div>
  )
}
