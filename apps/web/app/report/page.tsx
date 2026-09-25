'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { Report as ReportShape } from '@agon/core'
import { FIXTURE_NOTE } from '../../src/fixture-note.js'
import {
  RULE_ANSWERS,
  RULE_QUESTION,
  type RuleAnswer,
  coverageLine,
  exceptionsLine,
  metricLines,
  rangeLine,
  ruleLine,
  unsupportedLines,
  unsupportedSummary,
} from '../../src/present.js'

const panel = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '1rem 1.15rem',
  marginBottom: '1rem',
}

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(9rem, auto) 1fr',
        gap: '0.45rem 1rem',
        margin: 0,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--muted)' }}>{row.label}</dt>
          <dd style={{ margin: 0 }}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// useSearchParams has to sit inside a Suspense boundary or Next opts the whole route out of
// static rendering at build time.
export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <Report />
    </Suspense>
  )
}

function Report() {
  const fromLanding = useSearchParams().get('wallet') ?? ''
  const [wallet, setWallet] = useState(fromLanding)
  const [report, setReport] = useState<ReportShape | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<RuleAnswer | null>(null)
  const [answerNote, setAnswerNote] = useState('')

  const load = useCallback(async (address: string) => {
    setError('')
    setReport(null)
    setAnswer(null)
    setAnswerNote('')
    setBusy(true)
    try {
      const res = await fetch(`/api/report?wallet=${encodeURIComponent(address.trim())}`)
      const body = await res.json()
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `The report request came back ${res.status}.`)
        return
      }
      setReport(body as ReportShape)
    } catch (cause) {
      setError(`The report request did not reach us (${(cause as Error).name}). Nothing was read.`)
    } finally {
      setBusy(false)
    }
  }, [])

  // Arriving from the landing page with an address already in hand is not a step the user takes,
  // so the report starts itself. That is what keeps the path to a report at 2 actions.
  useEffect(() => {
    if (fromLanding !== '') void load(fromLanding)
  }, [fromLanding, load])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await load(wallet)
  }

  async function answerQuestion(choice: RuleAnswer) {
    setAnswer(choice)
    setAnswerNote('Recording your answer.')
    try {
      const res = await fetch('/api/rule-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: report?.wallet, answer: choice }),
      })
      const body = await res.json()
      // Never "thanks" unless it was actually stored. The CP3 gate is a percentage of these.
      setAnswerNote(res.ok ? 'Recorded. Thank you.' : `${body.error} ${body.detail}`)
    } catch (cause) {
      setAnswerNote(
        `Your answer was not recorded: the request did not reach us (${(cause as Error).name}).`,
      )
    }
  }

  return (
    <main
      style={{
        maxWidth: '42rem',
        margin: '0 auto',
        padding: '2rem 1rem 4rem',
        font: '16px/1.55 ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: '0.3rem' }}>Your trading profile</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Paste a Solana address. Read only: no account, no login, no key, no signature, no wallet
        connection.
      </p>

      <form onSubmit={submit} style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="wallet"
          style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}
        >
          Solana address
        </label>
        <input
          id="wallet"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          aria-describedby="wallet-error"
          style={{ width: '100%', padding: '0.6rem 0.7rem', font: 'inherit' }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: '0.75rem',
            padding: '0.6rem 1.2rem',
            font: 'inherit',
            fontWeight: 600,
          }}
        >
          {busy ? 'Reading' : 'Build my report'}
        </button>
        <p id="wallet-error" role="alert" style={{ color: 'var(--bad, #9b2226)' }}>
          {error}
        </p>
      </form>

      {report && (
        <section aria-live="polite">
          <p role="note" style={{ ...panel, background: 'var(--warn, #fff4e5)' }}>
            <strong>{FIXTURE_NOTE}</strong>
          </p>

          <h2 style={{ fontSize: '1.05rem', wordBreak: 'break-all' }}>{report.wallet}</h2>
          <p style={{ color: 'var(--muted)' }}>{rangeLine(report)}</p>

          <section style={panel} aria-labelledby="habits">
            <h3 id="habits" style={{ marginTop: 0 }}>
              What you do
            </h3>
            <Rows rows={report.rules.map(ruleLine)} />
          </section>

          <section style={panel} aria-labelledby="numbers">
            <h3 id="numbers" style={{ marginTop: 0 }}>
              The numbers behind it
            </h3>
            <Rows rows={metricLines(report.metrics)} />
            <p style={{ marginBottom: 0 }}>{exceptionsLine(report)}</p>
          </section>

          <section style={panel} aria-labelledby="based-on">
            <h3 id="based-on" style={{ marginTop: 0 }}>
              What this is based on
            </h3>
            <p style={{ marginTop: 0 }}>{coverageLine(report)}</p>
            <p>{unsupportedSummary(report)}</p>
            {unsupportedLines(report).length > 0 && <Rows rows={unsupportedLines(report)} />}
            <p style={{ color: 'var(--muted)', marginBottom: 0 }}>
              Read at slot {report.dataSlot}, rule version {report.ruleVersion}.
            </p>
          </section>

          <section style={panel} aria-labelledby="ask">
            <h3 id="ask" style={{ marginTop: 0 }}>
              {RULE_QUESTION}
            </h3>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              {RULE_ANSWERS.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => answerQuestion(choice)}
                  aria-pressed={answer === choice}
                  style={{
                    padding: '0.5rem 1.1rem',
                    font: 'inherit',
                    fontWeight: answer === choice ? 700 : 400,
                    textTransform: 'capitalize',
                  }}
                >
                  {choice}
                </button>
              ))}
            </div>
            <p role="status" aria-live="polite" style={{ marginBottom: 0 }}>
              {answerNote}
            </p>
          </section>
        </section>
      )}
    </main>
  )
}
