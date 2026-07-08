// Single-table key layout, shared by the worker, the control-plane Lambdas,
// and the local harness scripts.
export const jobKey = (jobId: string) => ({ pk: `JOB#${jobId}`, sk: 'META' })
export const gameKey = (jobId: string, gameId: string) => ({ pk: `JOB#${jobId}`, sk: `GAME#${gameId}` })
export const cacheItemKey = (cacheKey: string) => ({ pk: `CACHE#${cacheKey}`, sk: 'META' })
export const lockKey = (username: string) => ({ pk: `LOCK#${username.toLowerCase()}`, sk: 'META' })
// metricsKey('TOTAL') is the all-time counter item feeding the landing ticker;
// dated keys hold the daily metrics rollup.
export const metricsKey = (utcDate: string) => ({ pk: `METRICS#${utcDate}`, sk: 'META' })
export const archiveKey = (username: string, month: string) => ({
  pk: `ARCHIVE#${username.toLowerCase()}`,
  sk: `MONTH#${month}`,
})
// Daily rate-limit counter on the (target username, requester IP) pair.
export const rateKey = (username: string, ip: string, utcDate: string) => ({
  pk: `RATE#${username.toLowerCase()}#${ip}`,
  sk: `DAY#${utcDate}`,
})
// Leaderboard: one partition holds every ranked user plus the daily
// blunder-of-the-day items, so the whole board reads as a single Query.
// ponytail: hot-partition risk only matters at a scale this table won't see.
export const leaderUserKey = (username: string) => ({
  pk: 'LEADER',
  sk: `USER#${username.toLowerCase()}`,
})
export const leaderBlunderKey = (utcDate: string) => ({ pk: 'LEADER', sk: `BLUNDER#${utcDate}` })

// Sparse GSI: only jobs currently in analyzing status carry these attributes,
// so the janitor's sweep reads nothing else.
export const STATUS_GSI = 'gsi1'
export const analyzingGsiAttrs = (deadlineAt: string) => ({
  gsi1pk: 'STATUS#analyzing',
  gsi1sk: deadlineAt,
})
