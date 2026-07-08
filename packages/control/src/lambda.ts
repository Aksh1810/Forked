import { handle } from 'hono/aws-lambda'
import { makeDeps } from '@forked/worker'
import { makeApp } from './app.js'
import { makeChessCom } from './chesscom.js'
import { loadControlConfig } from './env.js'
import { runJanitor } from './janitor.js'

// Lambda entrypoints: one api function serving every route behind a Function
// URL (which supplies CORS itself, hence cors: false), plus the EventBridge
// Scheduler janitor.
const cfg = loadControlConfig()
const deps = makeDeps(cfg)
const app = makeApp(deps, cfg, makeChessCom(deps, { contactEmail: cfg.contactEmail }), { cors: false })

export const handler = handle(app)
export const janitor = () => runJanitor(deps, cfg)
