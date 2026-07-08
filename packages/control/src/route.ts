import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { metricsKey } from '@forked/shared'
import { resolveQueueUrl, type Deps } from '@forked/worker'
import type { ControlConfig } from './env.js'

// Lambda functions hard-cap at 900s and the estimate below is crude, so
// anything projected past 600s keeps a 1.5x margin and goes container-only.
const LAMBDA_MAX_SEC = 600

export type RouterCfg = Pick<
  ControlConfig,
  'queueName' | 'lambdaQueueName' | 'gbSecondsBudget' | 'estimatedNps'
>

export type PickQueue = (plies: number, nodeBudget: number) => string

// Per-game queue picker. Resolves both queue URLs and reads the monthly
// GB-seconds counter ONCE per call (one job), then routes each game: Lambda
// while the monthly budget holds and the game's runtime estimate fits,
// container otherwise. LAMBDA_QUEUE_NAME unset (the local default) sends
// everything to the container queue, the exact pre-Phase-5 behavior.
export async function makeRouter(deps: Deps, cfg: RouterCfg): Promise<PickQueue> {
  const containerUrl = await resolveQueueUrl(deps.sqs, cfg.queueName)
  if (!cfg.lambdaQueueName) return () => containerUrl

  const lambdaUrl = await resolveQueueUrl(deps.sqs, cfg.lambdaQueueName)
  const month = new Date().toISOString().slice(0, 7)
  const out = await deps.ddb.send(
    new GetCommand({
      TableName: deps.table,
      Key: metricsKey(month),
      ProjectionExpression: 'lambdaGbSeconds',
    }),
  )
  // ponytail: budget checked once per job, not per game; a burst of concurrent
  // jobs can overshoot by a few jobs' worth, which the 100k GB-s headroom eats.
  if (Number(out.Item?.lambdaGbSeconds ?? 0) >= cfg.gbSecondsBudget) return () => containerUrl

  return (plies, nodeBudget) =>
    (plies * nodeBudget) / cfg.estimatedNps <= LAMBDA_MAX_SEC ? lambdaUrl : containerUrl
}
