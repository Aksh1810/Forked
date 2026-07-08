// Docker-free local stack: downloads and runs DynamoDB Local and elasticmq as
// plain JVM jars, for machines without Docker. Same endpoints the compose
// stack exposes (dynamodb on 8000, elasticmq on 9324), so the control API,
// the worker, and the kill-test harness all talk to it unchanged.
//
// Usage: node scripts/local/jvm-stack.mjs up   (foreground; Ctrl-C to stop)
//        node scripts/local/jvm-stack.mjs down
//
// Requires java (17+) on PATH. ponytail: no health-check retries or pidfiles;
// this is a dev convenience, the compose stack is the real one.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = join(homedir(), '.cache', 'forked-stack')
const DDB_TAR = 'https://s3.us-west-2.amazonaws.com/dynamodb-local/dynamodb_local_latest.tar.gz'
const EMQ_JAR =
  'https://github.com/softwaremill/elasticmq/releases/download/v1.7.1/elasticmq-server-all-1.7.1.jar'

const EMQ_CONF = `include classpath("application.conf")

queues {
  analysis-tasks {
    defaultVisibilityTimeout = ${process.env.VISIBILITY_SEC ?? 20} seconds
    receiveMessageWait = 1 seconds
    deadLettersQueue {
      name = "analysis-tasks-dlq"
      maxReceiveCount = 5
    }
  }
  analysis-tasks-lambda {
    defaultVisibilityTimeout = 60 seconds
    receiveMessageWait = 1 seconds
    deadLettersQueue {
      name = "analysis-tasks-dlq"
      maxReceiveCount = 5
    }
  }
  analysis-tasks-dlq {}
}
`

function ensureAssets() {
  mkdirSync(DIR, { recursive: true })
  if (!existsSync(join(DIR, 'DynamoDBLocal.jar'))) {
    console.log('downloading dynamodb-local...')
    execSync(`curl -sL -o "${join(DIR, 'ddb.tar.gz')}" "${DDB_TAR}"`, { stdio: 'inherit' })
    execSync(`tar xzf "${join(DIR, 'ddb.tar.gz')}" -C "${DIR}"`, { stdio: 'inherit' })
  }
  if (!existsSync(join(DIR, 'elasticmq.jar'))) {
    console.log('downloading elasticmq...')
    execSync(`curl -sL -o "${join(DIR, 'elasticmq.jar')}" "${EMQ_JAR}"`, { stdio: 'inherit' })
  }
  writeFileSync(join(DIR, 'elasticmq.conf'), EMQ_CONF)
}

if (process.argv[2] === 'down') {
  // Best-effort: kill by jar name.
  for (const pat of ['DynamoDBLocal.jar', 'elasticmq.jar']) {
    try {
      execSync(`pkill -f ${pat}`)
    } catch {
      // not running
    }
  }
  console.log('stack stopped')
  process.exit(0)
}

ensureAssets()
const ddb = spawn(
  'java',
  ['-Djava.library.path=./DynamoDBLocal_lib', '-jar', 'DynamoDBLocal.jar', '-inMemory', '-port', '8000'],
  { cwd: DIR, stdio: 'inherit' },
)
const emq = spawn('java', [`-Dconfig.file=${join(DIR, 'elasticmq.conf')}`, '-jar', 'elasticmq.jar'], {
  cwd: DIR,
  stdio: 'inherit',
})
console.log('stack up: dynamodb http://localhost:8000, elasticmq http://localhost:9324 (Ctrl-C to stop)')
const stop = () => {
  ddb.kill()
  emq.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
