// One-command local dev: local stack (dynamodb+elasticmq) + control API +
// worker + web, all in one process tree. Ctrl-C stops everything.
//
// Usage: node scripts/local/dev.mjs
//
// Requires: npx tsc -b already run (worker/control dist/ present), java on
// PATH (jvm-stack), stockfish on PATH or STOCKFISH_PATH set.
// ponytail: no health-check retries, just fixed sleeps before the next
// stage — this is a dev convenience, not the CI stack.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const LOCAL_ENV = {
  ...process.env,
  DYNAMO_ENDPOINT: 'http://localhost:8000',
  SQS_ENDPOINT: 'http://localhost:9324',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'local',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
  AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
}

const children = []
function run(name, cmd, args, opts = {}) {
  const proc = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: LOCAL_ENV, ...opts })
  proc.on('exit', (code) => {
    if (code && code !== 0) console.error(`[${name}] exited with code ${code}`)
  })
  children.push(proc)
  return proc
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
function shutdown() {
  for (const c of children) c.kill()
  process.exit(0)
}

run('stack', 'node', ['scripts/local/jvm-stack.mjs', 'up'])
console.log('[dev] waiting for dynamodb:8000 + elasticmq:9324 ...')
await waitForPort(8000)
await waitForPort(9324)

run('worker', 'node', ['packages/worker/dist/main.js'])
run('api', 'npm', ['run', 'api', '-w', 'packages/control'])
console.log('[dev] waiting for control api:8787 ...')
await waitForPort(8787)

run('web', 'npm', ['run', 'dev', '-w', 'packages/web'])
console.log('[dev] all up — web on http://localhost:3000 (Ctrl-C to stop everything)')

async function waitForPort(port) {
  for (;;) {
    try {
      await fetch(`http://localhost:${port}`)
      return
    } catch {
      await sleep(500)
    }
  }
}
