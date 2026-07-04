// Shared helpers for local kill-test scripts. Talks to the docker compose
// stack (elasticmq on 9324, dynamodb-local on 8000) and reuses the exact
// production code paths from the built worker package (npm run build first).
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { CreateTableCommand, DynamoDBClient, ResourceInUseException } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import {
  CreateQueueCommand,
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs'
import {
  PINNED_ENGINE_VERSION,
  analyzingGsiAttrs,
  cacheKey,
  cacheItemKey,
  emptyPartialAgg,
  gameKey,
  jobKey,
  parseGamePgn,
} from '../../packages/shared/dist/index.js'
import {
  buildDoneOutcome,
  executeCompletion,
  tryFinalize,
} from '../../packages/worker/dist/index.js'

export const TABLE = 'blunderfarm'
export const ENGINE_VERSION = process.env.ENGINE_VERSION ?? PINNED_ENGINE_VERSION

const ddbClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})
export const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
})
export const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:9324',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})
export const deps = { ddb, sqs, table: TABLE }

export async function ensureTable() {
  try {
    await ddbClient.send(
      new CreateTableCommand({
        TableName: TABLE,
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        // PROVISIONED for parity with the always-free-tier production table;
        // dynamodb-local does not throttle either way.
        ProvisionedThroughput: { ReadCapacityUnits: 20, WriteCapacityUnits: 20 },
        GlobalSecondaryIndexes: [
          {
            IndexName: 'gsi1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
          },
        ],
      }),
    )
  } catch (err) {
    if (!(err instanceof ResourceInUseException)) throw err
  }
}

export async function queueUrl(name) {
  const out = await sqs.send(new GetQueueUrlCommand({ QueueName: name }))
  return out.QueueUrl
}

export async function ensureQueue(name, { visibilitySec = 30, dlqName = null, maxReceive = 5 } = {}) {
  let redrive
  if (dlqName) {
    await sqs.send(new CreateQueueCommand({ QueueName: dlqName })).catch(() => {})
    const dlqArn = `arn:aws:sqs:us-east-1:000000000000:${dlqName}`
    redrive = JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: String(maxReceive) })
  }
  await sqs
    .send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: {
          VisibilityTimeout: String(visibilitySec),
          ...(redrive ? { RedrivePolicy: redrive } : {}),
        },
      }),
    )
    .catch(() => {})
  return queueUrl(name)
}

// Creates a job from PGN texts through the same parse -> cache-check ->
// enqueue-or-complete flow production ingest uses. Returns the jobId and how
// many messages were actually enqueued (cache hits enqueue nothing).
export async function createJob(pgns, { nodeBudget = 150_000, username = 'kill_tester', queue = 'analysis-tasks', corrupt = [] } = {}) {
  const jobId = randomUUID()
  const url = await queueUrl(queue)
  const parsed = pgns.map((pgn, i) => {
    const g = parseGamePgn(pgn)
    if (!g.ok) throw new Error(`fixture pgn ${i} rejected: ${g.message}`)
    return g
  })

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        ...jobKey(jobId),
        ...analyzingGsiAttrs(new Date(Date.now() + 30 * 60_000).toISOString()),
        jobId,
        username,
        status: 'analyzing',
        total: parsed.length,
        completed: 0,
        failed: 0,
        nodeBudget,
        ring: [],
        agg: emptyPartialAgg(),
        createdAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    }),
  )

  let enqueued = 0
  for (const [i, g] of parsed.entries()) {
    const gameId = `g${i}`
    const uciMoves = corrupt.includes(i) ? [...g.uciMoves.slice(0, 2), 'e2e5x'] : g.uciMoves
    const key = cacheKey(uciMoves, ENGINE_VERSION, nodeBudget)
    const userColor = g.white.name === username ? 'white' : g.black.name === username ? 'black' : null
    const item = {
      ...gameKey(jobId, gameId),
      jobId,
      gameId,
      status: 'pending',
      attempts: 0,
      cacheKey: key,
      uciMoves,
      userColor,
      nodeBudget,
      game: {
        gameId,
        white: g.white,
        black: g.black,
        timeControl: g.timeControl,
        result: g.result,
        date: g.date,
        clocks: g.clocks,
        eco: g.eco,
        openingName: g.openingName,
        cacheKey: key,
      },
    }
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }))

    const cached = await ddb.send(new GetCommand({ TableName: TABLE, Key: cacheItemKey(key) }))
    if (cached.Item) {
      // Ingest-side cache hit: complete through THE transaction, no message.
      const outcome = buildDoneOutcome(
        { gameId, uciMoves, userColor, game: item.game },
        cached.Item.record,
        0,
      )
      const res = await executeCompletion(deps, jobId, gameId, outcome)
      if (res === 'applied') await tryFinalize(deps, jobId)
    } else {
      await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: JSON.stringify({ jobId, gameId }) }))
      enqueued += 1
    }
  }
  return { jobId, enqueued }
}

export async function getJob(jobId) {
  const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: jobKey(jobId) }))
  return out.Item ?? null
}

export async function listGames(jobId) {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :g)',
      ExpressionAttributeValues: { ':pk': `JOB#${jobId}`, ':g': 'GAME#' },
    }),
  )
  return out.Items ?? []
}

export async function waitForJob(jobId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = await getJob(jobId)
    if (job && (job.status === 'complete' || job.status === 'failed')) return job
    if (Date.now() > deadline) throw new Error(`timeout waiting for job ${jobId}: ${JSON.stringify(job)}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

export function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function assert(cond, msg) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`)
    process.exit(1)
  }
  console.log(`ok: ${msg}`)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
