import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { EngineRecordSchema, cacheItemKey, type EngineRecord } from '@forked/shared'
import type { Deps } from './db.js'

export async function getEngineRecord(deps: Deps, cacheKey: string): Promise<EngineRecord | null> {
  const out = await deps.ddb.send(
    new GetCommand({ TableName: deps.table, Key: cacheItemKey(cacheKey) }),
  )
  return out.Item ? EngineRecordSchema.parse(out.Item.record) : null
}

// Engine records are immutable and content-addressed; an unconditional put
// of a byte-identical record is safe under any race.
export async function putEngineRecord(deps: Deps, record: EngineRecord): Promise<void> {
  await deps.ddb.send(
    new PutCommand({
      TableName: deps.table,
      Item: { ...cacheItemKey(record.cacheKey), record, createdAt: new Date().toISOString() },
    }),
  )
}
