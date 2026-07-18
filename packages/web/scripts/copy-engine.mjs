// Copies the Stockfish lite single-threaded WASM build (+ its GPL license
// text) from node_modules into public/engine/, so Next serves it as a static
// asset. Runs as predev/prebuild — node_modules/stockfish isn't committed,
// and public/engine/ is gitignored.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = dirname(dirname(fileURLToPath(import.meta.url)))
const pkgDir = join(webDir, '..', '..', 'node_modules', 'stockfish')
const outDir = join(webDir, 'public', 'engine')

const files = [
  ['bin/stockfish-18-lite-single.js', 'stockfish-18-lite-single.js'],
  ['bin/stockfish-18-lite-single.wasm', 'stockfish-18-lite-single.wasm'],
  ['Copying.txt', 'Copying.txt'],
]

mkdirSync(outDir, { recursive: true })
for (const [src, dest] of files) {
  copyFileSync(join(pkgDir, src), join(outDir, dest))
}
