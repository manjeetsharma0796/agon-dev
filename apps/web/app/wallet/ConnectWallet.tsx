'use client'

import { getWallets } from '@wallet-standard/app'
import { useEffect, useState } from 'react'
import { connectable, solanaAddress } from './wallets.js'

type Wallet = ReturnType<ReturnType<typeof getWallets>['get']>[number]

// Connect a wallet to read its address, and nothing else. The address comes from the wallet, is
// never typed, and goes into the same /report handoff the paste field uses, so nothing downstream
// changes. Disconnect forgets it. No account, no login, no signature.

interface ConnectFeature {
  connect(): Promise<{ accounts: readonly { address: string; chains: readonly string[] }[] }>
}
interface DisconnectFeature {
  disconnect(): Promise<void>
}
interface EventsFeature {
  on(
    event: 'change',
    listener: (change: {
      accounts?: readonly { address: string; chains: readonly string[] }[]
    }) => void,
  ): () => void
}

export default function ConnectWallet({ onRead }: { onRead: (address: string) => void }) {
  // null until the browser has been asked, so a server render never claims "no wallet found".
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [connected, setConnected] = useState<{ wallet: Wallet; address: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const registry = getWallets()
    const refresh = () => setWallets(connectable(registry.get()))
    refresh()
    // A wallet extension can register after the page loads, so keep listening.
    const offRegister = registry.on('register', refresh)
    const offUnregister = registry.on('unregister', refresh)
    return () => {
      offRegister()
      offUnregister()
    }
  }, [])

  // Switching or locking the account in the wallet has to reach the page, or it would keep showing,
  // and reading the history of, a key that is no longer the connected one.
  const connectedWallet = connected?.wallet
  useEffect(() => {
    if (!connectedWallet) return
    const events = connectedWallet.features['standard:events'] as EventsFeature | undefined
    return events?.on('change', ({ accounts }) => {
      if (accounts === undefined) return
      const address = solanaAddress(accounts)
      setConnected(address === null ? null : { wallet: connectedWallet, address })
    })
  }, [connectedWallet])

  const connect = async (wallet: Wallet) => {
    setBusy(true)
    setProblem(null)
    try {
      const feature = wallet.features['standard:connect'] as ConnectFeature
      const { accounts } = await feature.connect()
      const address = solanaAddress(accounts)
      if (address === null) {
        setProblem(
          `${wallet.name} connected but shared 0 Solana accounts. Unlock it or add a Solana ` +
            'account in the wallet, then connect again, or paste an address below.',
        )
      } else {
        setConnected({ wallet, address })
      }
    } catch (error) {
      const why = error instanceof Error && error.message ? ` It said: "${error.message}".` : ''
      setProblem(
        `${wallet.name} did not share an address, so nothing was read.${why} Connect again, or ` +
          'paste an address below.',
      )
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    const wallet = connected?.wallet
    setConnected(null)
    setProblem(null)
    // Forgetting the address is what matters and it has already happened. A wallet without a
    // disconnect feature, or one that fails at it, still leaves this page holding nothing.
    await (wallet?.features['standard:disconnect'] as DisconnectFeature | undefined)
      ?.disconnect()
      .catch(() => undefined)
  }

  if (wallets === null) return null

  if (connected) {
    // The waitlist's wallet pill: icon, address, which wallet, and a change button at the end.
    return (
      <section aria-label="Connected wallet" className="form" style={{ marginTop: 24 }}>
        <div className="form__wallet">
          <img className="form__wallet-ico" src={connected.wallet.icon} alt="" />
          <span className="form__wallet-addr">{connected.address}</span>
          <span className="form__wallet-tag">{connected.wallet.name}</span>
          <button type="button" className="form__wallet-change" onClick={disconnect}>
            Disconnect
          </button>
        </div>
        <button type="button" className="form__submit" onClick={() => onRead(connected.address)}>
          Read my history
        </button>
      </section>
    )
  }

  return (
    <section aria-label="Connect a wallet">
      {wallets.length === 0 ? (
        <p className="form__fine">
          No Solana wallet found in this browser. Install Phantom or Backpack to connect one, or
          paste an address below.
        </p>
      ) : (
        <div className="wallets">
          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => connect(wallet)}
            >
              <img className="btn__ico" src={wallet.icon} alt="" width={16} height={16} />
              Connect {wallet.name}
            </button>
          ))}
        </div>
      )}
      {problem && (
        <p role="alert" className="form__status form__status--error">
          {problem}
        </p>
      )}
    </section>
  )
}
