import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs'
import type { WorkerConfig } from './env.js'

export interface Deps {
  ddb: DynamoDBDocumentClient
  sqs: SQSClient
  table: string
}

export function makeDeps(
  config: Pick<WorkerConfig, 'region' | 'dynamoEndpoint' | 'sqsEndpoint' | 'tableName'>,
): Deps {
  const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: config.region, endpoint: config.dynamoEndpoint }),
    { marshallOptions: { removeUndefinedValues: true } },
  )
  const sqs = new SQSClient({ region: config.region, endpoint: config.sqsEndpoint })
  return { ddb, sqs, table: config.tableName }
}

export async function resolveQueueUrl(sqs: SQSClient, queueName: string): Promise<string> {
  const out = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }))
  if (!out.QueueUrl) throw new Error(`queue not found: ${queueName}`)
  return out.QueueUrl
}
