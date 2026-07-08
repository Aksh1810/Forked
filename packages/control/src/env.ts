export interface ControlConfig {
  tableName: string
  region: string
  dynamoEndpoint: string | undefined
  sqsEndpoint: string | undefined
  queueName: string
  // Lambda-eligible queue. Unset (the local default) routes everything to
  // queueName, exactly the pre-Phase-5 behavior.
  lambdaQueueName: string | undefined
  // Monthly Lambda GB-seconds ceiling; past it, all new work routes
  // container-only. 300k of the 400k always-free allowance leaves headroom
  // for the api/janitor/dlq functions, which are not metered by the counter.
  gbSecondsBudget: number
  // Crude single-core Stockfish throughput used by the routing estimate.
  estimatedNps: number
  contactEmail: string
  maxGamesPerJob: number
  nodeBudget: number
  ratePerDay: number
  port: number
}

export function loadControlConfig(env: NodeJS.ProcessEnv = process.env): ControlConfig {
  return {
    tableName: env.TABLE_NAME ?? 'forked',
    region: env.AWS_REGION ?? 'us-east-1',
    dynamoEndpoint: env.DYNAMO_ENDPOINT,
    sqsEndpoint: env.SQS_ENDPOINT,
    queueName: env.QUEUE_NAME ?? 'analysis-tasks',
    lambdaQueueName: env.LAMBDA_QUEUE_NAME,
    gbSecondsBudget: Number(env.GB_SECONDS_BUDGET ?? 300_000),
    estimatedNps: Number(env.ESTIMATED_NPS ?? 350_000),
    // chess.com API etiquette requires a descriptive User-Agent with a
    // reachable contact.
    contactEmail: env.CONTACT_EMAIL ?? 'contact-unset@example.com',
    maxGamesPerJob: Number(env.MAX_GAMES_PER_JOB ?? 500),
    nodeBudget: Number(env.NODE_BUDGET ?? 600_000),
    ratePerDay: Number(env.RATE_PER_DAY ?? 5),
    port: Number(env.PORT ?? 8787),
  }
}
