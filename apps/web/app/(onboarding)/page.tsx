'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// The landing page, at /. A route group so the URL stays bare.
//
// T-E08 budgets 3 steps from here to a report. There are 2: paste an address, press the button.
// The report page reads the address off the query string and starts on its own, so arriving there
// is not a third thing the user has to do. Everything else on this page is reading, not steps.

export default function Landing() {
  const router = useRouter()
  const [wallet, setWallet] = useState('')

  return (
    <main
      style={{
        maxWidth: '38rem',
        margin: '0 auto',
        padding: '3rem 1rem 4rem',
        font: '16px/1.6 ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '2rem', lineHeight: 1.15, margin: '0 0 0.75rem' }}>
        Your own trading history, as a limit your agent has to trade inside
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '1.05rem', marginTop: 0 }}>
        Agon reads what you already do, finds the rules you actually follow, and can turn them into
        a cap enforced on Solana. Start by looking at your own history.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          router.push(`/report?wallet=${encodeURIComponent(wallet.trim())}`)
        }}
        style={{ margin: '2rem 0' }}
      >
        <label
          htmlFor="wallet"
          style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}
        >
          Your Solana address
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <input
            id="wallet"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Paste an address"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            style={{ flex: '1 1 20rem', padding: '0.7rem', font: 'inherit' }}
          />
          <button
            type="submit"
            disabled={wallet.trim() === ''}
            style={{ padding: '0.7rem 1.4rem', font: 'inherit', fontWeight: 600 }}
          >
            Read my history
          </button>
        </div>
      </form>

      {/* The three things a stranger needs to believe before pasting an address. */}
      <ul style={{ listStyle: 'none', padding: 0, color: 'var(--muted)' }}>
        <li>No account and no login. Nothing to sign up for.</li>
        <li>Read only. No signature, no wallet connection, and your key is never involved.</li>
        <li>
          An address is public. Pasting one here tells us nothing the chain does not already say.
        </li>
      </ul>

      <p style={{ marginTop: '2rem' }}>
        Driving an agent instead? The four MCP tools are documented in{' '}
        <code>docs/public/mcp-tools.md</code>, generated from the same contracts the server
        validates against.
      </p>
    </main>
  )
}
