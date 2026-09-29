import { network } from '@agon/core'
import { connection } from 'next/server'
import ArmClient from './ArmClient'

// The gate, server side and read per request. Arming runs on the fork only until T-D04's mainnet
// checklist is ticked, so on any other network this page refuses rather than offering a button.
// It reads the same AGON_NETWORK as the banner above it, so the two cannot disagree.

export default async function ArmPage() {
  await connection()
  const net = network(process.env['AGON_NETWORK'])
  const rpcUrl = process.env['AGON_RPC_URL']

  if (net.id !== 'fork') {
    return (
      <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Arming is not available here</h1>
        <p>
          This deployment is on {net.short}. Arming a vault runs on the practice fork only, until
          the mainnet checklist is complete and signed off. Nothing on this page can move funds.
        </p>
      </main>
    )
  }
  if (rpcUrl === undefined || rpcUrl === '') {
    return (
      <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>No chain configured</h1>
        <p>
          AGON_RPC_URL is not set, so this page has no fork to read your vault from. Set it to the
          fork, for example http://127.0.0.1:8899, and reload.
        </p>
      </main>
    )
  }
  return <ArmClient rpcUrl={rpcUrl} />
}
