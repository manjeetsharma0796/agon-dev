'use client'

import { useState } from 'react'
import { FIXTURE_NOTE } from '../../src/fixture-note.js'
import type { Report } from '@agon/core'

export default function ReportPage() {
  const [wallet, setWallet] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setReport(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/report?wallet=${encodeURIComponent(wallet.trim())}`)
      const body = await res.json()
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `The report request came back ${res.status}.`)
        return
      }
      setReport(body as Report)
    } catch (cause) {
      setError(`The report request did not reach us (${(cause as Error).name}). Nothing was read.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      style={{ maxWidth: '38rem', margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui' }}
    >
      <h1>Your trading profile</h1>
      <p>Paste a Solana address. Read only: no key, no signature, no wallet connection.</p>

      <form onSubmit={submit}>
        <label htmlFor="wallet" style={{ display: 'block', fontWeight: 600 }}>
          Solana address
        </label>
        <input
          id="wallet"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          aria-describedby="wallet-error"
          style={{ width: '100%', padding: '0.6rem', marginTop: '0.3rem' }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{ marginTop: '0.75rem', padding: '0.6rem 1.2rem' }}
        >
          {busy ? 'Reading' : 'Build my report'}
        </button>
      </form>

      <p id="wallet-error" role="alert" style={{ color: '#9b2226' }}>
        {error}
      </p>

      {report && (
        <section aria-live="polite">
          {/* Said next to the numbers, not in a footnote. They are not this wallet's numbers. */}
          <p
            role="note"
            style={{ background: '#fff4e5', padding: '0.6rem', border: '1px solid #e0b884' }}
          >
            <strong>{FIXTURE_NOTE}</strong>
          </p>
          <h2>{report.wallet}</h2>
          <ul>
            <li>Closed trades: {report.metrics.closedTrades}</li>
            <li>Median size: {report.metrics.medianSize} base units</li>
            <li>Median hold: {report.metrics.medianHoldSeconds}s</li>
            <li>Realised P&amp;L: {report.metrics.realisedPnl} base units</li>
            <li>Rules found: {report.rules.length}</li>
            <li>
              Exceptions: {report.exceptions.count}, costing {report.exceptions.cost} base units
            </li>
          </ul>
          <p>
            Read at slot {report.dataSlot}, rule version {report.ruleVersion}.
          </p>
        </section>
      )}
    </main>
  )
}
