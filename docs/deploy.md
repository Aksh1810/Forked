# Deploy runbook

First deployed 2026-07-08 (us-east-1). Gates (a)-(d) all pass. What remains
manual after any fresh deploy: confirming the SNS subscription email.

Everything in the stack builds and tests without Docker: `cdk synth`, the
stack tests, and the esbuild-bundled control functions are Docker-free.
`cdk deploy` is NOT: the worker image (packages/worker/Dockerfile.lambda)
builds at deploy time. Building the amd64 image on an arm64 Mac works fine
under Docker Desktop's Rosetta emulation (the aws-lambda-ric native compile
is the slow part, a few minutes, cached thereafter).

## Deploy-day lessons (already fixed, kept for the record)

- aws-lambda-ric@4's preinstall unpacks a curl source tarball with xz:
  the image build stage needs `xz-utils`.
- .dockerignore must exclude `**/*.tsbuildinfo` alongside `**/dist`:
  tsbuildinfo lives at package roots, and a staged stale buildinfo with no
  dist makes the in-image `tsc -b` skip emitting entirely.
- aws-lambda-ric resolves the handler relative to LAMBDA_TASK_ROOT, which
  Lambda hard-sets to /var/task for container images: the runtime stage
  must `WORKDIR /var/task`, not /app.
- Lambda lazily pages container images in over the network: the FIRST
  engine spawn in a fresh sandbox took ~26s (vs milliseconds warm), so the
  engine boot timeout is 60s (BOOT_TIMEOUT_MS in worker/src/uci.ts).
- cdk staging copies the whole repo (with tests) into
  packages/control/cdk.out: vitest excludes cdk.out or the suite
  multi-counts against stale copies.

## One-time setup

1. AWS account + an IAM identity with admin (or CDK-bootstrap) rights.
2. `npm ci && npx tsc -b`
3. `cd packages/control && npx cdk bootstrap aws://<account-id>/us-east-1`

## Deploy

```
cd packages/control
npx cdk deploy -c alarmEmail=you@example.com
```

- Confirm the SNS subscription email that arrives (alarms are silent until
  you click it).
- Note the `Forked.ApiUrl` output. Set `NEXT_PUBLIC_API_BASE` to it for the
  web build (Vercel env var or `.env.production`), then deploy the web app.

## Optional: home-box container worker

The container queue (`analysis-tasks`) is drained by any machine running the
existing worker image:

```
docker build -f packages/worker/Dockerfile -t forked-worker .
docker run -e TABLE_NAME=forked -e AWS_REGION=us-east-1 \
  -e QUEUE_NAME=analysis-tasks \
  -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... forked-worker
```

Give that IAM user only: table read/write on `forked`, and receive/delete/
change-visibility + GetQueueUrl on `analysis-tasks`. Without a home worker,
long games routed to the container queue sit until one shows up, and the
queue-age alarm fires after an hour: that alarm doubles as the "home worker
is down" page.

## Deploy-day gates (b) and (c)

Gates (a) and (d) already run locally (`node scripts/local/gate-phase5.mjs`).

**Gate (b): burst safety.** Ingest a ~100-game archive. In CloudWatch verify:

- Lambda ConcurrentExecutions for the worker function never exceeds 5
  (ScalingConfig caps it).
- DLQ NumberOfMessagesSent = 0 and worker Errors = 0 for the run.
- The job completes and the wrapped summary renders.

**Gate (c): capacity honesty.** During the same job, chart DynamoDB
ConsumedReadCapacityUnits and ConsumedWriteCapacityUnits against the
estimates in docs/costs.md. If reality disagrees with the doc, fix the doc
(and if consumption approaches 20/20 sustained, that is a design bug to fix,
not a reason to raise capacity).

## Hygiene

- `npx cdk gc --unstable=gc` occasionally: ECR image storage is the one
  not-always-free cost (pennies, but no reason to hoard old images).
- The table is RemovalPolicy.RETAIN: `cdk destroy` keeps the data on
  purpose; delete the table manually if you truly want it gone.
