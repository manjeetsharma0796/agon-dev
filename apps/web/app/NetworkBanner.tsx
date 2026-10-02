import { network } from '@agon/core'
import { connection } from 'next/server'

// Which chain this deployment points at, on every page, so test money is never mistaken for real
// money or the reverse. Server side, so it reads the same AGON_NETWORK the MCP server does.
// Read per request, not at build, or a page prerendered with one value would contradict an MCP
// server started with another. role="status" and data-network stay as they are: the Docker
// health check and the onboarding measurement read them.

export default async function NetworkBanner() {
  await connection()
  const net = network(process.env['AGON_NETWORK'])
  return (
    <div role="status" data-network={net.id} className={`net net--${net.tone}`}>
      {net.text}
    </div>
  )
}
