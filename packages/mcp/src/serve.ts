#!/usr/bin/env node
// The agon MCP server, over Streamable HTTP, so it can be port forwarded and pointed at from
// another machine.
//
// `node:http` rather than express: the SDK's transport takes a plain Node request and response, and
// express would be a dependency earning nothing. There is no router here because there are 3
// fixed paths.
//
// Stateless on purpose. `sessionIdGenerator: undefined` means every request carries its own
// transport and nothing is remembered between calls, which is what you want for a server whose
// every tool is a read: there is no session state worth losing, and a client that reconnects or a
// tunnel that drops costs nothing.

import { readFileSync } from 'node:fs'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './index.js'
import { routeStream } from './stream.js'
import { serveMarket } from './market.js'
import { liveIo } from './io.js'
import { activityRoute, journalFor } from './journal.js'

const PORT = Number(process.env['PORT'] ?? 8787)
/** Loopback by default. Binding 0.0.0.0 exposes an unauthenticated server to the whole network. */
const HOST = process.env['HOST'] ?? '127.0.0.1'
/** The agent kit: 1 file an agent downloads and runs on its own machine, so we never see a key. */
const KIT = readFileSync(new URL('../kit/agon-kit.mjs', import.meta.url))
/** A host name or IP with an optional port, and nothing else, since it is written into text. */
const PLAIN_HOST = /^([\w.-]+|\[[\da-f:]+\])(:\d{1,5})?$/i
/** Plain http only on this machine: the kit holds a key, so from anywhere else it comes over TLS. */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:|$)/i
/** The journal (T-C30): Neon when DATABASE_URL is set, else every write a named failure. */
const JOURNAL = journalFor(process.env['DATABASE_URL'])

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // One health path, so somebody checking a tunnel gets an answer instead of a protocol error.
  //
  // HEAD as well as GET, because that is what uptime monitors and several load balancer probes
  // send, and answering them 404 makes the one URL anybody watches report the service as down while
  // it is serving. A HEAD response carries the headers and no body, which is why `end` is called
  // with nothing rather than with the same JSON.
  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      req.method === 'HEAD'
        ? undefined
        : JSON.stringify({ ok: true, server: 'agon', transport: 'streamable-http', path: '/mcp' }),
    )
    return
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/kit.mjs') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    res.end(req.method === 'HEAD' ? undefined : KIT)
    return
  }
  if (routeStream(req, res)) return
  if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/market') {
    await serveMarket(new URL(req.url ?? '/', 'http://localhost'), res)
    return
  }
  // The journal's signed read (T-C30): 401 with the reason unless signed by the owner or a hired key.
  const path = new URL(req.url ?? '/', 'http://local')
  if (req.method === 'GET' && path.pathname === '/activity') {
    const { status, body } = await activityRoute(path, liveIo(), JOURNAL)
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
    return
  }
  if (!(req.url ?? '').startsWith('/mcp')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: `No route for ${req.method ?? 'GET'} ${req.url ?? '/'}. The MCP endpoint is /mcp.`,
      }),
    )
    return
  }

  // A transport and a server per request, and both closed when the response ends. Sharing one
  // across requests is what leaks when a client disconnects mid-stream.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  // The kit's address as this client reached us, so it is right behind any port mapping.
  const host = req.headers.host ?? ''
  const scheme = LOOPBACK.test(host) ? 'http' : 'https'
  const server = createServer(
    undefined,
    PLAIN_HOST.test(host) ? `${scheme}://${host}/kit.mjs` : undefined,
    JOURNAL,
  )
  res.on('close', () => {
    void transport.close()
    void server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res)
  } catch (error) {
    // Never a bare 500. The caller is an agent, and an error with no cause is one it cannot act on.
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    if (!res.writableEnded) {
      res.end(
        JSON.stringify({
          error: `The MCP request failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
      )
    }
  }
}

createHttpServer((req, res) => {
  void handle(req, res)
}).listen(PORT, HOST, () => {
  // stderr, not stdout: stdout is the transport when this same server is run over stdio, and a
  // banner printed there corrupts the first message.
  console.error(`agon MCP on http://${HOST}:${PORT}/mcp (health at /health)`)
})
