#!/usr/bin/env node
// Fake UCI engine that replays recorded transcript responses: the SCRIPT env
// var holds a JSON array; the Nth `go` emits the Nth entry's lines (the last
// entry repeats if there are more `go`s than entries).
import { createInterface } from 'node:readline'

const script = JSON.parse(process.env.SCRIPT ?? '[]')
let goCount = 0

const out = (s) => process.stdout.write(`${s}\n`)
createInterface({ input: process.stdin }).on('line', (line) => {
  const cmd = line.trim()
  if (cmd === 'uci') {
    out('id name FakeScripted 1')
    out('uciok')
  } else if (cmd === 'isready') {
    out('readyok')
  } else if (cmd.startsWith('go ')) {
    const lines = script[Math.min(goCount, script.length - 1)] ?? []
    goCount += 1
    for (const l of lines) out(l)
  }
})
