#!/usr/bin/env node
// Fake UCI engine that answers the handshake, then wedges forever on any
// `go`. Used to prove the watchdog kills, respawns, and eventually fails.
import { createInterface } from 'node:readline'

const out = (s) => process.stdout.write(`${s}\n`)
createInterface({ input: process.stdin }).on('line', (line) => {
  const cmd = line.trim()
  if (cmd === 'uci') {
    out('id name FakeWedgeAlways 1')
    out('uciok')
  } else if (cmd === 'isready') {
    out('readyok')
  }
  // any `go` is silently swallowed: the wedge
})
