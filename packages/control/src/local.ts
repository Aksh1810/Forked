import { createServer } from 'node:http'
import { log, makeDeps } from '@forked/worker'
import { makeApp } from './app.js'
import { makeChessCom } from './chesscom.js'
import { loadControlConfig } from './env.js'
import { runJanitor } from './janitor.js'

// Local dev entrypoint: a minimal node:http bridge to the fetch-style hono
// app. ponytail: @hono/node-server is not on the approved dependency list
// and this is all the adapter these JSON endpoints need; production uses
// Lambda Function URLs (Phase 5), not this server.
const cfg = loadControlConfig()
const deps = makeDeps(cfg)
const app = makeApp(deps, cfg, makeChessCom(deps, { contactEmail: cfg.contactEmail }))

// Mirror the Lambda Function URL's 6MB payload cap so a self-hosted server
// cannot be ballooned by an arbitrarily large POST body.
const MAX_BODY_BYTES = 5 * 1024 * 1024

const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of nodeReq) {
      bytes += (chunk as Buffer).length
      if (bytes > MAX_BODY_BYTES) {
        nodeRes.writeHead(413, { 'content-type': 'application/json' })
        nodeRes.end(JSON.stringify({ ok: false, code: 'too-large' }))
        nodeReq.destroy()
        return
      }
      chunks.push(chunk as Buffer)
    }
    const headers = new Headers()
    for (const [k, v] of Object.entries(nodeReq.headers)) {
      if (typeof v === 'string') headers.set(k, v)
      else if (Array.isArray(v)) for (const x of v) headers.append(k, x)
    }
    // APPEND the socket address rather than trusting a client-sent header:
    // the app reads the last entry, the one this trusted hop wrote.
    if (nodeReq.socket.remoteAddress) {
      headers.append('x-forwarded-for', nodeReq.socket.remoteAddress)
    }
    const hasBody = chunks.length > 0 && nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD'
    const res = await app.fetch(
      new Request(`http://${nodeReq.headers.host ?? 'localhost'}${nodeReq.url ?? '/'}`, {
        method: nodeReq.method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
      }),
    )
    nodeRes.writeHead(res.status, Object.fromEntries(res.headers))
    nodeRes.end(Buffer.from(await res.arrayBuffer()))
  } catch (err) {
    console.error(err)
    nodeRes.writeHead(500, { 'content-type': 'application/json' })
    nodeRes.end(JSON.stringify({ ok: false, code: 'internal' }))
  }
})

server.listen(cfg.port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'control api listening', port: cfg.port }))
})

// Local stand-in for the EventBridge janitor cron. The interval is short so
// the local stack self-heals visibly; production runs it every 10 minutes.
const janitorMs = Number(process.env.JANITOR_MS ?? 30_000)
if (janitorMs > 0) {
  setInterval(() => {
    runJanitor(deps, cfg).catch((err) => log('error', 'janitor sweep failed', { error: String(err) }))
  }, janitorMs).unref()
}
