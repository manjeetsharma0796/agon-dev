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

const buttonStyle = { padding: '0.7rem 1.4rem', font: 'inherit', fontWeight: 600 } as const

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
    return (
      <section aria-label="Connected wallet" style={{ margin: '2rem 0' }}>
        <p style={{ margin: '0 0 0.3rem', fontWeight: 600 }}>
          Address from {connected.wallet.name}
        </p>
        <p
          style={{
            margin: '0 0 0.8rem',
            fontFamily: 'ui-monospace, monospace',
            wordBreak: 'break-all',
          }}
        >
          {connected.address}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onRead(connected.address)} style={buttonStyle}>
            Read my history
          </button>
          <button type="button" onClick={disconnect} style={{ ...buttonStyle, fontWeight: 400 }}>
            Disconnect
          </button>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Connect a wallet" style={{ margin: '2rem 0' }}>
      {wallets.length === 0 ? (
        <p style={{ margin: 0 }}>
          No Solana wallet found in this browser. Install Phantom or Backpack to connect one, or
          paste an address below.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              type="button"
              disabled={busy}
              onClick={() => connect(wallet)}
              style={{
                ...buttonStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <img src={wallet.icon} alt="" width={20} height={20} />
              Connect {wallet.name}
            </button>
          ))}
        </div>
      )}
      {problem && (
        <p role="alert" style={{ margin: '0.8rem 0 0' }}>
          {problem}
        </p>
      )}
    </section>
  )
}
