export interface WorkerConfig {
  tableName: string
  region: string
  dynamoEndpoint: string | undefined
  sqsEndpoint: string | undefined
  queueName: string
  dlqName: string
  visibilitySec: number
  heartbeatSec: number
  graceMs: number
  mode: 'worker' | 'dlq'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    tableName: env.TABLE_NAME ?? 'blunderfarm',
    region: env.AWS_REGION ?? 'us-east-1',
    dynamoEndpoint: env.DYNAMO_ENDPOINT,
    sqsEndpoint: env.SQS_ENDPOINT,
    queueName: env.QUEUE_NAME ?? 'analysis-tasks',
    dlqName: env.DLQ_NAME ?? 'analysis-tasks-dlq',
    visibilitySec: Number(env.VISIBILITY_SEC ?? 180),
    heartbeatSec: Number(env.HEARTBEAT_SEC ?? 60),
    graceMs: Number(env.GRACE_MS ?? 30_000),
    mode: env.WORKER_MODE === 'dlq' ? 'dlq' : 'worker',
  }
}
