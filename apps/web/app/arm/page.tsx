import { network } from '@agon/core'
import { connection } from 'next/server'
import ArmClient from './ArmClient'

// The gate in front of the vault screen. It runs on the practice fork only, and only with a chain
// to read from; each refusal says which it is and what to do. Read per request, like the banner.

function Refusal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="shell shell--narrow">
      <section className="card step" aria-labelledby="refusal">
        <p className="eyebrow">
          <span className="dot" /> Vault
        </p>
        <h1 id="refusal" className="h2 h2--sm">
          {title}
        </h1>
        <p>{children}</p>
      </section>
    </main>
  )
}

export default async function ArmPage() {
  await connection()
  const net = network(process.env['AGON_NETWORK'])
  const rpcUrl = process.env['AGON_RPC_URL']

  if (net.id !== 'fork') {
    return (
      <Refusal title="Arming is not available here">
        This deployment is on {net.short}. Arming a vault runs on the practice fork only, until the
        mainnet checklist is complete and signed off. Nothing on this page can move funds.
      </Refusal>
    )
  }
  if (rpcUrl === undefined || rpcUrl === '') {
    return (
      <Refusal title="No chain configured">
        AGON_RPC_URL is not set, so this page has no fork to read your vault from. Set it to the
        fork, for example http://127.0.0.1:8899, and reload.
      </Refusal>
    )
  }
  return <ArmClient rpcUrl={rpcUrl} />
}
