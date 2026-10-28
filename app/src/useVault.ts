import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { LEASH_ABI, readPolicy, readAutonomy, walletErrorMessage } from '@/leash-contract'
import { useNetwork } from '@/network'

/** All vault state both pages need, read in one multicall and refreshed every 8 seconds. */
export function useVault() {
  const { network } = useNetwork()
  const { address } = useAccount()
  const vault = network.vault
  const base = { address: vault ?? undefined, abi: LEASH_ABI, chainId: network.chain.id } as const

  const { data, refetch, isLoading } = useReadContracts({
    contracts: [
      { ...base, functionName: 'owner' },
      { ...base, functionName: 'policy' },
      { ...base, functionName: 'frozen' },
      { ...base, functionName: 'balance' },
      { ...base, functionName: 'autonomyRate' },
      { ...base, functionName: 'remainingToday' },
      { ...base, functionName: 'allowlistSize' },
    ],
    query: { enabled: !!vault, refetchInterval: 15000 },
  })

  const owner = data?.[0]?.result as `0x${string}` | undefined
  return {
    vault,
    isLoading,
    refetch,
    owner,
    isOwner: !!owner && !!address && owner.toLowerCase() === address.toLowerCase(),
    policy: readPolicy(data?.[1]?.result),
    frozen: data?.[2]?.result as boolean | undefined,
    balance: data?.[3]?.result as bigint | undefined,
    autonomy: readAutonomy(data?.[4]?.result),
    remainingToday: data?.[5]?.result as bigint | undefined,
    allowlistSize: data?.[6]?.result as bigint | undefined,
  }
}

/** Owner writes: switches the wallet to the selected network first, toasts, and refreshes every query on confirmation. */
export function useVaultWrite() {
  const { network } = useNetwork()
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()
  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, chainId: network.chain.id })

  useEffect(() => {
    if (!isSuccess) return
    toast.success('Confirmed on Arc')
    void queryClient.invalidateQueries()
  }, [isSuccess, queryClient])

  async function write(functionName: string, args: unknown[] = [], value?: bigint) {
    if (!network.vault) return
    try {
      if (chainId !== network.chain.id) await switchChainAsync({ chainId: network.chain.id })
      await writeContractAsync({ address: network.vault, abi: LEASH_ABI, functionName, args, value, chainId: network.chain.id })
    } catch (err) {
      toast.error(walletErrorMessage(err, 'Transaction was not sent'))
    }
  }

  return { write, busy: isPending || isConfirming }
}
