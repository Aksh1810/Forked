#!/usr/bin/env node
// Fake UCI engine that wedges on `go` for the FIRST process lifetime only
// (tracked via a marker file in WEDGE_MARKER), then behaves deterministically
// after a respawn. Every received command is appended to CMD_LOG so tests can
// prove the retried game restarted from ply 1.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const marker = process.env.WEDGE_MARKER
const log = process.env.CMD_LOG
const wedge = marker && !existsSync(marker)
if (wedge) writeFileSync(marker, 'wedged\n')

const out = (s) => process.stdout.write(`${s}\n`)
createInterface({ input: process.stdin }).on('line', (line) => {
  const cmd = line.trim()
  if (log) appendFileSync(log, `${cmd}\n`)
  if (cmd === 'uci') {
    out('id name FakeWedgeOnce 1')
    out('uciok')
  } else if (cmd === 'isready') {
    out('readyok')
  } else if (cmd.startsWith('go ') && !wedge) {
    out('info depth 3 multipv 1 score cp 0 nodes 50 nps 1000 pv d2d4 d7d5')
    out('bestmove d2d4')
  }
})
