import { PINNED_ENGINE_VERSION } from '@forked/shared'
import { makeDeps, resolveQueueUrl } from './db.js'
import { loadConfig } from './env.js'
import { log } from './log.js'
import { makePoller, requeueNow } from './poller.js'
import { Engine } from './uci.js'

// Container entrypoint. WORKER_MODE=dlq runs the dead-letter consumer loop
// instead of the analysis loop.
async function main(): Promise<void> {
  const config = loadConfig()
  const deps = makeDeps(config)
  const queueUrl = await resolveQueueUrl(deps.sqs, config.mode === 'dlq' ? config.dlqName : config.queueName)

  let engine: Engine | null = null
  if (config.mode === 'worker') {
    engine = await Engine.start()
    if (engine.version !== PINNED_ENGINE_VERSION) {
      log('warn', 'engine version differs from pinned version; cache keys will not match ingest', {
        reported: engine.version,
        pinned: PINNED_ENGINE_VERSION,
      })
    }
  }

  const controller = new AbortController()
  const poller = makePoller(deps, engine, {
    queueUrl,
    visibilitySec: config.visibilitySec,
    heartbeatSec: config.heartbeatSec,
    mode: config.mode,
  }, controller.signal)

  process.on('SIGTERM', () => {
    log('info', 'sigterm: stop polling, grace window begins', { graceMs: config.graceMs })
    controller.abort()
    const inflight = poller.current
    if (inflight) {
      const timer = setTimeout(() => {
        // The in-flight game did not fit the grace window: requeue instantly
        // and exit; another worker picks it up.
        log('info', 'grace expired, requeueing in-flight message and exiting')
        requeueNow(deps, queueUrl, inflight.receiptHandle)
          .catch(() => {})
          .finally(() => process.exit(0))
      }, config.graceMs)
      timer.unref()
    }
  })

  log('info', 'worker started', { mode: config.mode, queueUrl, engine: engine?.version ?? null })
  await poller.run()
  engine?.dispose()
  log('info', 'worker stopped cleanly')
  process.exit(0)
}

main().catch((err) => {
  log('error', 'worker crashed', { error: String(err) })
  process.exit(1)
})
