'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Mark from '../Mark'
import ConnectWallet from '../wallet/ConnectWallet'

// The landing page, at /. A route group so the URL stays bare.
//
// T-E08 budgets 3 steps from here to a report. There are 2: paste an address, press the button.
// The report page reads the address off the query string and starts on its own, so arriving there
// is not a third thing the user has to do. Everything else on this page is reading, not steps.
//
// The shape is the waitlist's hero: badge, headline, 1 glass panel holding the form.

export default function Landing() {
  const router = useRouter()
  const [wallet, setWallet] = useState('')
  const read = (address: string) => router.push(`/report?wallet=${encodeURIComponent(address)}`)

  return (
    <main className="hero">
      <span className="badge">
        <Mark className="badge__mark" id="badge" />
        Read only. No account, no signature.
      </span>
      <h1 className="headline">
        Your own trading history, as a limit your agent has to{' '}
        <span className="ember">trade inside</span>
      </h1>
      <p className="lede" style={{ textAlign: 'center' }}>
        Agon reads what you already do, finds the rules you actually follow, and can turn them into
        a cap enforced on Solana. Start by looking at your own history.
      </p>

      <section className="glass" aria-labelledby="start">
        <h2 id="start" className="glass__title">
          Start with the wallet that trades
        </h2>
        <p className="glass__copy">
          Connect it to read its address, or paste any Solana address. Nothing is signed either way.
        </p>

        {/* Connecting is optional: the paste field below still works for a visitor with no wallet. */}
        <ConnectWallet onRead={read} />

        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            read(wallet.trim())
          }}
        >
          <div className="form__field">
            <label htmlFor="wallet" className="sr-only">
              Or paste a Solana address
            </label>
            <input
              id="wallet"
              className="form__input form__input--mono"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="Or paste a Solana address"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
          </div>
          <button type="submit" className="form__submit" disabled={wallet.trim() === ''}>
            Read my history
          </button>
        </form>

        {/* The three things a stranger needs to believe before pasting an address. */}
        <p className="form__fine">
          No account and no login. Connecting a wallet only reads its address: nothing is ever
          signed, and your key is never involved. An address is public, so pasting one here tells us
          nothing the chain does not already say.
        </p>
      </section>

      <p className="form__fine" style={{ marginTop: 28 }}>
        Driving an agent instead? The MCP tools are documented in{' '}
        <code>docs/public/mcp-tools.md</code>, generated from the same contracts the server
        validates against.
      </p>
    </main>
  )
}
