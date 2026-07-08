import type { Deps } from '../src/db.js'

// Same tiny harness as control/test/fake-deps.ts; duplicated rather than
// imported across package boundaries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>

export interface Call {
  name: string
  input: Loose
}

// One fake client serves as both ddb and sqs: every command is recorded and
// answered by the test's dispatcher (throw inside it to simulate failures).
export function fakeDeps(respond: (call: Call) => unknown) {
  const calls: Call[] = []
  const send = async (cmd: { constructor: { name: string }; input: unknown }) => {
    const call: Call = { name: cmd.constructor.name, input: cmd.input as Loose }
    calls.push(call)
    return (await respond(call)) ?? {}
  }
  const deps = { ddb: { send }, sqs: { send }, table: 't' } as unknown as Deps
  return { deps, calls }
}

export const byName = (calls: Call[], name: string) => calls.filter((c) => c.name === name)
