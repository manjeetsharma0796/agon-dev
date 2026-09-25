#!/usr/bin/env node
// The agon MCP server, over Streamable HTTP, so it can be port forwarded and pointed at from
// another machine.
//
// `node:http` rather than express: the SDK's transport takes a plain Node request and response, and
// express would be a dependency earning nothing. There is no router here because there is one
// route.
//
// Stateless on purpose. `sessionIdGenerator: undefined` means every request carries its own
// transport and nothing is remembered between calls, which is what you want for a server whose
// every tool is a read: there is no session state worth losing, and a client that reconnects or a
// tunnel that drops costs nothing.

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './index.js'

const PORT = Number(process.env['PORT'] ?? 8787)
/** Loopback by default. Binding 0.0.0.0 exposes an unauthenticated server to the whole network. */
const HOST = process.env['HOST'] ?? '127.0.0.1'

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
  const server = createServer()
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
