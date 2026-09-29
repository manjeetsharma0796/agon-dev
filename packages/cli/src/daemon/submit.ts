// Send one signed transaction and never let it land twice.
//
// The rule is to resend the same signed bytes, never a rebuilt transaction. A signature can be
// processed at most once, so resending those bytes any number of times cannot debit twice. A
// rebuilt transaction has a new blockhash and so a new signature, and that is how a retry turns
// into a double send. So once the blockhash has expired with no status for the signature, the
// transaction is confirmed dropped: those bytes can never land now, and this stops and says so.
// Building a new one is a new trade, and it goes back through check_trade.

import type { Connection, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'

type Submitted =
  | { status: 'landed'; signature: string; sends: number }
  | { status: 'failed'; signature: string; sends: number; error: string }
  | { status: 'dropped'; signature: string; sends: number; message: string }

type Chain = Pick<Connection, 'sendRawTransaction' | 'getSignatureStatuses' | 'getBlockHeight'>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function submitOnce(
  chain: Chain,
  signed: VersionedTransaction,
  lastValidBlockHeight: number,
  resendEveryMs = 2000,
): Promise<Submitted> {
  const bytes = signed.serialize()
  const first = signed.signatures[0]
  if (first === undefined || first.every((b) => b === 0)) {
    throw new Error('The transaction has no signature, so it was not sent. Sign it first.')
  }
  const signature = bs58.encode(first)
  let sends = 0
  for (;;) {
    // A send that throws is not evidence either way: the status check below is what decides.
    await chain.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 }).catch(() => null)
    sends++
    const deadline = Date.now() + resendEveryMs
    while (Date.now() < deadline) {
      const [status] = (await chain.getSignatureStatuses([signature])).value
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        return status.err === null
          ? { status: 'landed', signature, sends }
          : { status: 'failed', signature, sends, error: JSON.stringify(status.err) }
      }
      await sleep(400)
    }
    // Checked before every resend, never after: the status above has already been read for this
    // round, so a transaction that landed is never sent again.
    const height = await chain.getBlockHeight('confirmed')
    if (height > lastValidBlockHeight) {
      const [status] = (
        await chain.getSignatureStatuses([signature], { searchTransactionHistory: true })
      ).value
      if (status === null) {
        return {
          status: 'dropped',
          signature,
          sends,
          message:
            `Transaction ${signature} was sent ${sends} times and never landed, and its blockhash ` +
            `expired at block ${lastValidBlockHeight} (now ${height}), so it can never land. Nothing ` +
            `moved. Run check_trade again for a fresh transaction.`,
        }
      }
    }
  }
}
