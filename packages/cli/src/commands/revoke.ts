// `agon revoke`. T-D03.
//
// One command removes every Agon role from every wallet it is given. It is the thing a user runs
// when they have stopped trusting the agent, so it does the smallest, most legible thing possible
// and reports exactly what it touched.
//
// All chain access is injected. The planning and the wording are pure, which is why they can be
// tested without a keypair, and why the devnet run proves the wiring rather than the logic.

import { planRevokeAll, openOrderNotice, revokedMessage, type OnChainRole } from '@agon/chain'

export interface RevokeIo {
  /** Every role on this wallet's Swig account, as the chain holds it. */
  loadRoles(wallet: string): Promise<OnChainRole[]>
  /** The mint a role caps, or null when it cannot be read. Null means the role is left alone. */
  mintOf(role: OnChainRole): string | null
  /** Funds sitting in an open Jupiter order, already formatted, for example "2.0 SOL". */
  openOrder(wallet: string): Promise<string | null>
  /** Submit the removals as 1 transaction and return its signature. */
  submit(wallet: string, roleIds: readonly number[]): Promise<string>
}

interface WalletResult {
  wallet: string
  revoked: number[]
  kept: { id: number; reason: string }[]
  signature: string | null
  /** Set when the removals did not fit in 1 transaction, which the acceptance forbids silently. */
  tooManyForOneSignature: boolean
  openOrder: string | null
  /** Set when the chain could not be read or the submit failed. Never swallowed. */
  failure: string | null
}

interface RevokeReport {
  results: WalletResult[]
  /** True only when every wallet ended with 0 Agon roles. What the acceptance measures. */
  allClear: boolean
}

export async function revoke(wallets: readonly string[], io: RevokeIo): Promise<RevokeReport> {
  const results: WalletResult[] = []

  for (const wallet of wallets) {
    const base: WalletResult = {
      wallet,
      revoked: [],
      kept: [],
      signature: null,
      tooManyForOneSignature: false,
      openOrder: null,
      failure: null,
    }
    let roles: OnChainRole[]
    try {
      roles = await io.loadRoles(wallet)
    } catch (error) {
      // A wallet we could not read is not a wallet we can call clear.
      results.push({
        ...base,
        failure: `Could not read the roles on ${wallet}: ${message(error)}. Nothing was revoked, so assume the agent is still armed.`,
      })
      continue
    }

    const plan = planRevokeAll(roles, io.mintOf)
    const openOrder = await io.openOrder(wallet).catch(() => null)

    if (plan.revoke.length === 0) {
      results.push({ ...base, kept: plan.kept, openOrder })
      continue
    }
    if (!plan.oneSignature) {
      results.push({
        ...base,
        kept: plan.kept,
        openOrder,
        tooManyForOneSignature: true,
        failure: `${plan.revoke.length} Agon roles is more than fits in 1 transaction, and this command will not split a revoke across signatures without saying so. Revoke from the wallet UI, or run again once the count is lower.`,
      })
      continue
    }

    try {
      const signature = await io.submit(wallet, plan.revoke)
      results.push({ ...base, revoked: plan.revoke, kept: plan.kept, signature, openOrder })
    } catch (error) {
      results.push({
        ...base,
        kept: plan.kept,
        openOrder,
        failure: `The revoke transaction for ${wallet} did not land: ${message(error)}. The roles are still there.`,
      })
    }
  }

  return { results, allClear: results.every((r) => r.failure === null) }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** What the user reads. One block per wallet, and never a claim the chain did not back. */
export function renderRevoke(report: RevokeReport): string {
  const out: string[] = []
  for (const r of report.results) {
    out.push(r.wallet)
    if (r.failure !== null) {
      out.push(`  ${r.failure}`)
    } else {
      const plan = { revoke: r.revoked, kept: r.kept, oneSignature: true }
      // The open-order sentence replaces the plain one, because it already opens with "Rule
      // revoked." and saying both would bury where the money actually is.
      out.push(`  ${r.openOrder === null ? revokedMessage(plan) : openOrderNotice(r.openOrder)}`)
      if (r.signature !== null) out.push(`  Signature ${r.signature}`)
    }
    for (const kept of r.kept) out.push(`  Role ${kept.id} was left alone: ${kept.reason}`)
    out.push('')
  }
  out.push(
    report.allClear
      ? `${report.results.length} wallet(s) checked, 0 Agon roles left.`
      : `${report.results.filter((r) => r.failure !== null).length} of ${report.results.length} wallet(s) still need attention.`,
  )
  return out.join('\n')
}

/**
 * `agon revoke <wallet> [wallet...]`.
 *
 * Returns the process exit code: 0 only when every wallet ended with 0 Agon roles. A kill switch
 * that exits 0 while a role is still live is worse than one that crashes.
 *
 * The chain side is not wired yet and says so rather than pretending. Building the removal
 * transaction needs a funded devnet key to have been tested against, and there has not been one.
 * What is here is the planning, the refusals and the wording, all of which are covered by tests.
 */
export async function runRevoke(wallets: readonly string[]): Promise<number> {
  if (wallets.length === 0) {
    console.error('Usage: agon revoke <wallet> [wallet...]. Give at least 1 wallet address.')
    return 2
  }
  console.error(
    `Cannot revoke ${wallets.length} wallet(s): this build has no chain connection wired in, so ` +
      `nothing was read and nothing was removed. Assume every agent is still armed. Revoke from ` +
      `your wallet in the meantime.`,
  )
  return 2
}
