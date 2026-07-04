// Structured JSON logging. Every line touching a job or game must carry that
// jobId and gameId in fields.
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields }))
}
