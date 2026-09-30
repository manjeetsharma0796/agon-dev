'use client'

// The vault screen. Working functionality only: the look is T-E16's, done with a person looking.
//
// Everything it does is a call into src/arm-flow.ts, which the fork test drives with a keypair in
// the wallet's place. This file is the wallet plumbing and the markup around those calls.

import { Buffer } from 'buffer'
import { getWallets } from '@wallet-standard/app'
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { arm, hire, loadVault, revoke, type Sign, type VaultView } from '../../src/arm-flow'
import { formatSol, formatUnits, parseSol } from '../../src/sol'
import { connectable } from '../wallet/wallets'

// web3.js and the Swig builders use Node's Buffer, which a browser does not have. Next.js bundles
// its own copy of `buffer` for client code, so this import needs no dependency of ours.
const g = globalThis as unknown as { Buffer?: typeof Buffer }
g.Buffer ??= Buffer

type Wallet = ReturnType<ReturnType<typeof getWallets>['get']>[number]
type Account = Wallet['accounts'][number]
interface SignFeature {
  signTransaction: (
    ...inputs: { account: Account; transaction: Uint8Array }[]
  ) => Promise<{ signedTransaction: Uint8Array }[]>
}
interface ConnectFeature {
  connect: () => Promise<{ accounts: readonly Account[] }>
}

const WINDOW_DEFAULT = '150'

export default function ArmClient({ rpcUrl }: { rpcUrl: string }) {
  const conn = useMemo(() => new Connection(rpcUrl, 'confirmed'), [rpcUrl])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [who, setWho] = useState<{ wallet: Wallet; account: Account } | null>(null)
  const [view, setView] = useState<VaultView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const [deposit, setDeposit] = useState('1')
  const [cap, setCap] = useState('0.5')
  const [slots, setSlots] = useState(WINDOW_DEFAULT)
  const [agent, setAgent] = useState('')
  const [practiceSecret, setPracticeSecret] = useState<string | null>(null)

  useEffect(() => {
    const registry = getWallets()
    const refresh = () => setWallets(connectable(registry.get()))
    refresh()
    return registry.on('register', refresh)
  }, [])

  const owner = who ? new PublicKey(who.account.address) : null

  // arm_rule links here with the wallet in the fragment. Arming always acts on the wallet that
  // connects, so a different one is said out loud rather than silently armed in its place.
  const [linkedFor, setLinkedFor] = useState<string | null>(null)
  // The agent's own public key rides in the same fragment (T-C24), so nobody copies it here by hand.
  const [agentFromLink, setAgentFromLink] = useState(false)
  useEffect(() => {
    const hash = globalThis.location?.hash ?? ''
    const m = /wallet=([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(hash)
    setLinkedFor(m?.[1] ?? null)
    const a = /agent=([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(hash)?.[1]
    if (a !== undefined) {
      setAgent(a)
      setAgentFromLink(true)
    }
  }, [])

  /** The wallet signs; we only hand it bytes and take bytes back. */
  const sign: Sign | null = who
    ? async (tx) => {
        const feature = who.wallet.features['solana:signTransaction'] as SignFeature | undefined
        if (!feature)
          throw new Error(`${who.wallet.name} cannot sign transactions, so nothing was sent.`)
        const [out] = await feature.signTransaction({
          account: who.account,
          transaction: tx.serialize(),
        })
        if (!out)
          throw new Error(`${who.wallet.name} returned no signed transaction. Nothing was sent.`)
        return VersionedTransaction.deserialize(out.signedTransaction)
      }
    : null

  // The wallet's own SOL, so the user sees before approving whether it covers the deposit.
  const [sol, setSol] = useState<bigint | null>(null)
  const reload = useCallback(async () => {
    if (!owner) return
    setView(await loadVault(conn, owner))
    setSol(BigInt(await conn.getBalance(owner)))
  }, [conn, owner?.toBase58()])

  useEffect(() => {
    reload().catch((e: unknown) =>
      setProblem(`Could not read your vault from ${rpcUrl}: ${String(e)}`),
    )
  }, [reload, rpcUrl])

  // Shown above every form the link pre-fills, create or re-hire: a pre-filled key is one nobody
  // typed, so the page says plainly whose it must be before anyone approves.
  const linkKeyNote = (
    <p role="note">
      Your agent&apos;s public key came with its link and is filled in below. Continue only if your
      own agent gave you this link: whoever holds that key can trade from this vault up to the limit
      you set.
    </p>
  )

  /** Run one step, and always say what happened, including when it did not. */
  const run = async (label: string, step: () => Promise<string>) => {
    setBusy(label)
    setProblem(null)
    setDone(null)
    try {
      setDone(await step())
      await reload()
    } catch (e) {
      setProblem(`${label} did not complete: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const connect = async (wallet: Wallet) => {
    setProblem(null)
    try {
      const { accounts } = await (wallet.features['standard:connect'] as ConnectFeature).connect()
      const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:')))
      if (!account) throw new Error(`${wallet.name} shared no Solana account.`)
      setWho({ wallet, account })
    } catch (e) {
      setProblem(`Could not connect ${wallet.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** Parse every number the user typed, exactly, before any wallet is asked for anything. */
  const typed = () => {
    let agentKey: PublicKey
    try {
      agentKey = new PublicKey(agent.trim())
    } catch {
      throw new Error(
        `"${agent}" is not a Solana public key. Paste the agent's public key, not its secret.`,
      )
    }
    const windowSlots = BigInt(/^\d+$/.test(slots.trim()) ? slots.trim() : '0')
    if (windowSlots <= 0n)
      throw new Error(`"${slots}" is not a whole number of slots. 150 is about a minute.`)
    return { agent: agentKey, cap: parseSol(cap), window: windowSlots }
  }

  const capLamports = (() => {
    try {
      return parseSol(cap)
    } catch {
      return null
    }
  })()

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '2rem auto',
        padding: '0 1rem',
        font: '16px/1.5 system-ui, sans-serif',
      }}
    >
      <h1>Your agent's vault</h1>
      <p>
        A vault is a separate account your wallet controls. Your agent can trade from it through
        Jupiter only, up to the limit you set, and you can take that away at any time from your own
        wallet. Agon never holds a key.
      </p>

      {problem && (
        <p role="alert" style={{ color: 'var(--bad)' }}>
          {problem}
        </p>
      )}
      {done && <p role="status">{done}</p>}
      {busy && <p role="status">{busy}: waiting for your wallet and the chain…</p>}

      {!who && (
        <section aria-labelledby="connect">
          <h2 id="connect">1. Connect your wallet</h2>
          {wallets.length === 0 && (
            <p>
              No Solana wallet found. Install Phantom or Backpack, and in Phantom turn on Developer
              Settings, Testnet Mode, Solana Localnet.
            </p>
          )}
          {wallets.map((w) => (
            <button key={w.name} type="button" onClick={() => connect(w)} disabled={busy !== null}>
              Connect {w.name}
            </button>
          ))}
        </section>
      )}

      {who && owner && (
        <p>
          Connected: <code style={{ overflowWrap: 'anywhere' }}>{owner.toBase58()}</code> through{' '}
          {who.wallet.name}
          {sol !== null && (
            <>
              , holding <strong>{formatSol(sol)} SOL</strong>
            </>
          )}
          .{' '}
          <button type="button" onClick={() => reload()} disabled={busy !== null}>
            Refresh
          </button>{' '}
          {/* This page only runs on the practice fork, so this is free test SOL there and nowhere else. */}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('Getting practice SOL', async () => {
                const signature = await conn.requestAirdrop(owner, 5_000_000_000)
                await conn.confirmTransaction(signature, 'confirmed')
                await reload()
                return `5 practice SOL arrived in ${signature}. It exists on this fork only.`
              })
            }
          >
            Get 5 practice SOL
          </button>
        </p>
      )}

      {who && linkedFor !== null && linkedFor !== who.account.address && (
        <p role="alert">
          This link was made for {linkedFor}, and the wallet you connected is {who.account.address}.
          Anything you do here acts on the connected wallet. Switch wallets in {who.wallet.name} if
          that is not the one you meant.
        </p>
      )}

      {view && view.squatted > 0 && (
        <p role="alert">
          {view.squatted} of your vault addresses already held an account your wallet does not
          control. Someone created it first. It was skipped and never used; your vault is at the
          next one.
        </p>
      )}

      {who && view?.kind === 'none' && sign && owner && (
        <section aria-labelledby="create">
          <h2 id="create">2. Create and fund your vault</h2>
          <p>
            Your wallet asks you to approve 2 transactions: one creates and funds the vault, one
            lets the agent trade and sends its key 0.01 SOL for its fees.
          </p>
          {agentFromLink && linkKeyNote}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run('Arming', async () => {
                const t = typed()
                const r = await arm(conn, { owner, depositLamports: parseSol(deposit), ...t }, sign)
                return `Vault created in ${r.fundSignature} and the agent added in ${r.hireSignature}.`
              })
            }}
          >
            <label>
              Deposit, in SOL{' '}
              <input
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <p>
              This is the most the agent can ever trade with. The rest of your wallet is out of its
              reach.
            </p>
            <AgentFields
              cap={cap}
              setCap={setCap}
              slots={slots}
              setSlots={setSlots}
              agent={agent}
              setAgent={setAgent}
              capLamports={capLamports}
              onPractice={() => {
                const kp = Keypair.generate()
                setAgent(kp.publicKey.toBase58())
                setPracticeSecret(JSON.stringify(Array.from(kp.secretKey)))
              }}
            />
            <button type="submit" disabled={busy !== null}>
              Create vault and add agent
            </button>
          </form>
        </section>
      )}

      {practiceSecret && (
        <section aria-labelledby="secret">
          <h2 id="secret">Your practice agent key</h2>
          <p role="alert">
            This key exists only on this page and is shown once. Copy it into your agent's config
            now; reloading loses it. It is a practice key for the fork only: never use a key made in
            a web page for real funds.
          </p>
          <textarea
            readOnly
            rows={3}
            style={{ width: '100%' }}
            value={practiceSecret}
            aria-label="Practice agent secret key"
          />
          <button type="button" onClick={() => setPracticeSecret(null)}>
            I have copied it, hide it
          </button>
        </section>
      )}

      {who && view?.kind === 'vault' && sign && owner && (
        <section aria-labelledby="vault">
          <h2 id="vault">Your vault</h2>
          <p>
            Address <code>{view.vault}</code> (
            <a
              href={`https://explorer.solana.com/address/${view.vault}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`}
              target="_blank"
              rel="noreferrer"
            >
              see it in the explorer
            </a>
            )
          </p>
          <p>
            Holds <strong>{formatSol(view.wsol)} wSOL</strong> and{' '}
            <strong>{formatUnits(view.usdc, 6)} USDC</strong>. Shown here because Phantom's own
            balance screen does not work on the practice network.
          </p>

          {view.agents.length === 0 ? (
            <>
              <p>No agent can trade from this vault right now.</p>
              {agentFromLink && linkKeyNote}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void run('Adding the agent', async () => {
                    const sig = await hire(conn, { owner, ...typed() }, sign)
                    return `Agent added in ${sig}.`
                  })
                }}
              >
                <AgentFields
                  cap={cap}
                  setCap={setCap}
                  slots={slots}
                  setSlots={setSlots}
                  agent={agent}
                  setAgent={setAgent}
                  capLamports={capLamports}
                  onPractice={() => {
                    const kp = Keypair.generate()
                    setAgent(kp.publicKey.toBase58())
                    setPracticeSecret(JSON.stringify(Array.from(kp.secretKey)))
                  }}
                />
                <button type="submit" disabled={busy !== null}>
                  Add agent
                </button>
              </form>
            </>
          ) : (
            <>
              <ul>
                {view.agents.map((a) => (
                  <li key={`${a.roleId}-${a.mint}`}>
                    Agent role {a.roleId}: up to{' '}
                    <strong>
                      {formatSol(a.cap)} wSOL per {a.window.toString()} slots
                    </strong>
                    , and up to {formatSol(a.rollingWorstCase)} in a short burst across a window
                    edge. Stored allowance{' '}
                    {a.storedRemaining === null
                      ? 'unreadable'
                      : `${formatSol(a.storedRemaining)} wSOL`}
                    , which is only updated when the agent trades, so after a quiet window it reads
                    low.
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run('Revoking', async () => {
                    const r = await revoke(conn, owner, sign)
                    // A role the kill switch keeps is one it could not confirm is Agon's. Saying
                    // "the agent can no longer trade" while one remains would be a claim the chain
                    // does not back, so every kept role is named with its reason.
                    const kept = r.kept
                      .map((k) => `role ${k.id} was left in place because it is ${k.reason}`)
                      .join(' ')
                    if (r.signature === null) {
                      return kept === ''
                        ? 'There was no agent to revoke.'
                        : `Nothing was revoked: ${kept}`
                    }
                    return kept === ''
                      ? `Revoked in ${r.signature}. The agent can no longer trade. Your funds stayed in the vault.`
                      : `Revoked ${r.removed.length} agent role(s) in ${r.signature}. Your funds stayed in the vault. But ${kept}`
                  })
                }
              >
                Revoke the agent
              </button>
              <p>
                Revoking needs no help from Agon: your wallet signs it and the chain enforces it,
                whether or not this site is up. Funds stay in the vault.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  )
}

function AgentFields(p: {
  cap: string
  setCap: (v: string) => void
  slots: string
  setSlots: (v: string) => void
  agent: string
  setAgent: (v: string) => void
  capLamports: bigint | null
  onPractice: () => void
}) {
  return (
    // A fieldset will not shrink below its widest child by default, which pushed a phone screen
    // sideways; letting it shrink, with the key input capped at its width, keeps 375 px readable.
    <fieldset style={{ minInlineSize: 0 }}>
      <legend>What the agent may do</legend>
      <label>
        Limit per window, in wSOL{' '}
        <input
          value={p.cap}
          onChange={(e) => p.setCap(e.target.value)}
          inputMode="decimal"
          required
        />
      </label>
      {p.capLamports !== null && (
        <p>
          Up to {formatSol(p.capLamports)} per window, and up to {formatSol(2n * p.capLamports)} in
          a short burst across a window edge, because windows follow the chain's clock.
        </p>
      )}
      <label>
        Window, in slots{' '}
        <input
          value={p.slots}
          onChange={(e) => p.setSlots(e.target.value)}
          inputMode="numeric"
          required
        />
      </label>
      <p>About 400 ms per slot, so 150 is about a minute.</p>
      <label>
        Agent public key{' '}
        <input
          value={p.agent}
          onChange={(e) => p.setAgent(e.target.value)}
          required
          size={48}
          style={{ maxWidth: '100%' }}
        />
      </label>{' '}
      <button type="button" onClick={p.onPractice}>
        Make a practice agent key
      </button>
    </fieldset>
  )
}
