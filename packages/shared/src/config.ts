// One-place rename: every surface (UI, cards, README generators) reads the
// product name from this constant and nowhere else.
export const BRAND_NAME = 'blunderfarm'

// The engine version pinned in packages/worker/Dockerfile, as the binary
// reports it via "id name". Ingest uses it to compute cache keys before any
// worker runs; the worker fails loudly if its engine reports anything else.
export const PINNED_ENGINE_VERSION = 'Stockfish 18'
