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
// Sparse GSI: only jobs currently in analyzing status carry these attributes,
// so the janitor's sweep reads nothing else.
export const STATUS_GSI = 'gsi1'
export const analyzingGsiAttrs = (deadlineAt: string) => ({
  gsi1pk: 'STATUS#analyzing',
  gsi1sk: deadlineAt,
})
