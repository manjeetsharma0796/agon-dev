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

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="ledger" style={{ marginTop: 14 }}>
      {rows.map((row) => (
        <div key={row.label} className="ledger__row">
          <dt className="ledger__k">{row.label}</dt>
          <dd className="ledger__v">{row.value}</dd>
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
    <main className="shell shell--narrow">
      <header className="head">
        <p className="eyebrow">
          <span className="dot" /> Read only
        </p>
        <h1 className="h2">Your trading profile</h1>
        <p className="lede">
          Paste a Solana address. Read only: no account, no login, no key, no signature, no wallet
          connection.
        </p>
      </header>

      <form onSubmit={submit} className="form form--wide">
        <div className="form__field">
          <label htmlFor="wallet" className="sr-only">
            Solana address
          </label>
          <input
            id="wallet"
            className="form__input form__input--mono"
            placeholder="Solana address"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            aria-describedby="wallet-error"
          />
        </div>
        <button type="submit" className="form__submit" disabled={busy}>
          {busy ? 'Reading' : 'Build my report'}
        </button>
      </form>
      <p id="wallet-error" role="alert" className="form__status form__status--error">
        {error}
      </p>

      {report && (
        <section aria-live="polite">
          <p role="note" className="note note--alert">
            <strong>{FIXTURE_NOTE}</strong>
          </p>

          <section className="card step" aria-labelledby="who">
            <p className="eyebrow">
              <span className="dot" /> Wallet
            </p>
            <h2 id="who" className="h2 h2--sm" style={{ fontSize: 16, fontWeight: 400 }}>
              <code>{report.wallet}</code>
            </h2>
            <p>{rangeLine(report)}</p>
          </section>

          <section className="card step" aria-labelledby="habits">
            <h3 id="habits" className="h2 h2--sm">
              What you do
            </h3>
            <Rows rows={report.rules.map(ruleLine)} />
          </section>

          <section className="card step" aria-labelledby="numbers">
            <h3 id="numbers" className="h2 h2--sm">
              The numbers behind it
            </h3>
            <Rows rows={metricLines(report.metrics)} />
            <p>{exceptionsLine(report)}</p>
          </section>

          <section className="card step" aria-labelledby="based-on">
            <h3 id="based-on" className="h2 h2--sm">
              What this is based on
            </h3>
            <p>{coverageLine(report)}</p>
            <p>{unsupportedSummary(report)}</p>
            {unsupportedLines(report).length > 0 && <Rows rows={unsupportedLines(report)} />}
            <p className="field__hint" style={{ marginTop: 14 }}>
              Read at slot {report.dataSlot}, rule version {report.ruleVersion}.
            </p>
          </section>

          <section className="card step" aria-labelledby="ask">
            <h3 id="ask" className="h2 h2--sm">
              {RULE_QUESTION}
            </h3>
            <div className="actions">
              {RULE_ANSWERS.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => answerQuestion(choice)}
                  aria-pressed={answer === choice}
                  style={{ textTransform: 'capitalize' }}
                >
                  {choice}
                </button>
              ))}
            </div>
            <p role="status" aria-live="polite" className="form__status">
              {answerNote}
            </p>
          </section>
        </section>
      )}
    </main>
  )
}
