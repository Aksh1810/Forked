import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

// Proves the CI harness runs a real Stockfish binary, which Phase 1's wrapper
// tests depend on. Locally the test skips when no binary is installed; in CI
// it always runs, so a missing binary fails the build instead of skipping.
const bin = process.env.STOCKFISH_PATH ?? 'stockfish'
// The npm `stockfish` package (the web app's browser wasm engine) shims a
// `stockfish` CLI into node_modules/.bin, which npm/vitest prepend to PATH —
// strip those entries so this probes the real native binary, not the shim.
const env = {
  ...process.env,
  PATH: (process.env.PATH ?? '')
    .split(':')
    .filter((p) => !p.includes('node_modules/.bin'))
    .join(':'),
}
const probe = spawnSync(bin, [], { input: 'quit\n', encoding: 'utf8', timeout: 5_000, env })
const available = !probe.error

it.skipIf(!available && !process.env.CI)('stockfish responds to uci with uciok', () => {
  const out = spawnSync(bin, [], { input: 'uci\nquit\n', encoding: 'utf8', timeout: 15_000, env })
  expect(out.error).toBeUndefined()
  expect(out.stdout).toContain('uciok')
  const idLine = out.stdout.split('\n').find((line) => line.startsWith('id name'))
  expect(idLine, 'engine must report its version via id name').toBeTruthy()
})
