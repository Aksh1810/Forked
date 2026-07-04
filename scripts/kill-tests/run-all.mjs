// Runs every kill-test gate in sequence against a fresh compose stack.
// Usage: node scripts/kill-tests/run-all.mjs
// The kill tests ARE the project's reliability claims; a flaky kill test is
// a failing build.
import { execSync, spawnSync } from 'node:child_process'

const run = (cmd, env = {}) => {
  console.log(`\n=== ${cmd}`)
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } })
}

run('npm run build --if-present')
run('npx tsc -b')
run('docker compose build worker')
run('docker compose up -d --scale worker=4 --scale dlq-consumer=0 elasticmq dynamodb worker', {
  VISIBILITY_SEC: '20',
  HEARTBEAT_SEC: '8',
})
// give the stack a moment
execSync('sleep 5')

const tests = [
  'a-worker-killed.mjs',
  'b-duplicate-delivery.mjs',
  'c-heartbeat.mjs',
  'd-poison-dlq.mjs',
  'e-sigterm-requeue.mjs',
  'f-cache-rerun.mjs',
]

const results = []
for (const t of tests) {
  console.log(`\n########## ${t}`)
  const r = spawnSync('node', [`scripts/kill-tests/${t}`], {
    stdio: 'inherit',
    env: { ...process.env, WITH_WORKERS: '1' },
  })
  results.push({ t, ok: r.status === 0 })
  if (r.status !== 0) break
}

console.log('\n========== SUMMARY')
for (const { t, ok } of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${t}`)
process.exit(results.every((r) => r.ok) && results.length === tests.length ? 0 : 1)
