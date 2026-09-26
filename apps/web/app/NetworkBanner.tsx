import { network } from '@agon/core'
import { connection } from 'next/server'

// Which chain this deployment points at, on every page, so test money is never mistaken for real
// money or the reverse. Server side, so it reads the same AGON_NETWORK the MCP server does.
// Read per request, not at build, or a page prerendered with one value would contradict an MCP
// server started with another.
// Foreground and background are both set, so it reads the same in a light or a dark theme.

const TONES = {
  test: { background: '#dbeafe', color: '#1e3a8a', borderBottom: '1px solid #93c5fd' },
  real: { background: '#fee2e2', color: '#7f1d1d', borderBottom: '1px solid #fca5a5' },
  warn: { background: '#fef3c7', color: '#78350f', borderBottom: '1px solid #fcd34d' },
} as const

export default async function NetworkBanner() {
  await connection()
  const net = network(process.env['AGON_NETWORK'])
  return (
    <div
      role="status"
      data-network={net.id}
      style={{
        ...TONES[net.tone],
        position: 'sticky',
        top: 0,
        zIndex: 10,
        padding: '0.4rem 1rem',
        textAlign: 'center',
        font: '600 14px/1.4 ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {net.text}
    </div>
  )
}
