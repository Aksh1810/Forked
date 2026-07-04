import type { GameTask } from '@blunderfarm/shared'
import { executeCompletion } from './completion.js'
import type { Deps } from './db.js'
import { tryFinalize } from './finalize.js'
import { log } from './log.js'

// THE DEAD-LETTER-QUEUE CONSUMER. A permanently failed game is marked failed
// through the exact same completion transaction, just reaching the failure
// branch, so no single poison game can leave a job stuck at 99 percent.
export async function processDlqTask(
  deps: Deps,
  task: GameTask,
  attempts: number,
): Promise<'applied' | 'noop'> {
  const result = await executeCompletion(deps, task.jobId, task.gameId, {
    kind: 'failed',
    error: 'poison: exceeded max receive count',
    attempts,
  })
  log('warn', 'dlq game marked failed', { jobId: task.jobId, gameId: task.gameId, result })
  if (result === 'applied') await tryFinalize(deps, task.jobId)
  return result
}
