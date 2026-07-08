import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cwActions,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_lambda_nodejs as nodejs,
  aws_scheduler as scheduler,
  aws_scheduler_targets as schedulerTargets,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
  aws_sqs as sqs,
  type StackProps,
} from 'aws-cdk-lib'
import type { Construct } from 'constructs'

// This file compiles to dist/lib/ but is also imported from source by the
// stack tests, so the repo root is found by walking up to the lockfile
// rather than hardcoding a ../.. depth.
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (!existsSync(path.join(dir, 'package-lock.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('repo root (package-lock.json) not found')
    dir = parent
  }
  return dir
}

// The whole production footprint, sized to live inside the AWS always-free
// tier except ECR image storage (pennies; see docs/costs.md).
export class ForkedStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    const root = repoRoot()

    // ---- DynamoDB: PROVISIONED 20/20 + gsi1 5/5 = exactly the 25/25 free
    // tier. On-demand is deliberately forbidden here: a runaway loop bills
    // per request, while provisioned just throttles (and alarms below).
    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'forked',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 20,
      writeCapacity: 20,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.RETAIN,
    })
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      // INCLUDE, not ALL: the janitor sweep reads only these three. ALL would
      // replicate the whole 2-6KB job item into the GSI on every counter/ring
      // update, burning the 5 GSI-WCU on write amplification alone.
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['jobId', 'username', 'status'],
      readCapacity: 5,
      writeCapacity: 5,
    })

    // ---- Queues. Two work queues (container + Lambda), ONE dead-letter
    // queue: a poison game is a poison game regardless of which fleet choked.
    const dlq = new sqs.Queue(this, 'Dlq', {
      queueName: 'analysis-tasks-dlq',
      retentionPeriod: Duration.days(14),
      // 6x the dlq-consumer function timeout, per AWS guidance.
      visibilityTimeout: Duration.seconds(360),
    })
    const redrive = { queue: dlq, maxReceiveCount: 5 }
    const containerQueue = new sqs.Queue(this, 'Tasks', {
      queueName: 'analysis-tasks',
      // The container worker heartbeats visibility while analyzing, so the
      // base timeout only needs to cover one heartbeat gap.
      visibilityTimeout: Duration.seconds(180),
      deadLetterQueue: redrive,
    })
    const lambdaQueue = new sqs.Queue(this, 'LambdaTasks', {
      queueName: 'analysis-tasks-lambda',
      // No heartbeat on Lambda: 6x the 900s function timeout, per AWS guidance.
      visibilityTimeout: Duration.seconds(5400),
      deadLetterQueue: redrive,
    })

    const contactEmail =
      (this.node.tryGetContext('alarmEmail') as string | undefined) ?? process.env.CONTACT_EMAIL

    // ---- Worker: container image (Stockfish inside), driven by SQS.
    // 1769MB is exactly one vCPU, all a single-threaded engine can use.
    // maxConcurrency caps the fleet at 5; NEVER reservedConcurrentExecutions,
    // which would reject deliveries and prematurely dead-letter games.
    const worker = new lambda.DockerImageFunction(this, 'Worker', {
      code: lambda.DockerImageCode.fromImageAsset(root, {
        file: 'packages/worker/Dockerfile.lambda',
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 1769,
      timeout: Duration.minutes(15),
      environment: { TABLE_NAME: table.tableName },
    })
    worker.addEventSource(
      new eventSources.SqsEventSource(lambdaQueue, {
        batchSize: 1,
        maxConcurrency: 5,
        reportBatchItemFailures: true,
      }),
    )

    // ---- Control plane: plain Node functions, esbuild-bundled (no Docker).
    const nodeDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      depsLockFilePath: path.join(root, 'package-lock.json'),
      bundling: { forceDockerBundling: false },
    }
    const controlEnv = {
      TABLE_NAME: table.tableName,
      QUEUE_NAME: containerQueue.queueName,
      LAMBDA_QUEUE_NAME: lambdaQueue.queueName,
      CONTACT_EMAIL: contactEmail ?? 'contact-unset@example.com',
    }

    // ONE api function + ONE Function URL for every route. NEVER API
    // Gateway: the URL is free, and Lambda already scales per-request.
    const api = new nodejs.NodejsFunction(this, 'Api', {
      ...nodeDefaults,
      entry: path.join(root, 'packages/control/src/lambda.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: Duration.seconds(300),
      environment: controlEnv,
    })
    const apiUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['content-type'],
      },
    })
    new CfnOutput(this, 'ApiUrl', { value: apiUrl.url })

    const janitor = new nodejs.NodejsFunction(this, 'Janitor', {
      ...nodeDefaults,
      entry: path.join(root, 'packages/control/src/lambda.ts'),
      handler: 'janitor',
      memorySize: 256,
      timeout: Duration.seconds(300),
      environment: controlEnv,
    })
    new scheduler.Schedule(this, 'JanitorSchedule', {
      schedule: scheduler.ScheduleExpression.rate(Duration.minutes(10)),
      target: new schedulerTargets.LambdaInvoke(janitor),
    })

    const dlqConsumer = new nodejs.NodejsFunction(this, 'DlqConsumer', {
      ...nodeDefaults,
      entry: path.join(root, 'packages/worker/src/lambda.ts'),
      handler: 'dlqHandler',
      memorySize: 256,
      timeout: Duration.seconds(60),
      environment: { TABLE_NAME: table.tableName },
    })
    dlqConsumer.addEventSource(
      new eventSources.SqsEventSource(dlq, { batchSize: 10, reportBatchItemFailures: true }),
    )

    // ---- Grants. Event sources grant their own consume permissions;
    // grantSendMessages includes sqs:GetQueueUrl, which resolveQueueUrl needs.
    for (const fn of [worker, api, janitor, dlqConsumer]) table.grantReadWriteData(fn)
    for (const q of [containerQueue, lambdaQueue]) {
      q.grantSendMessages(api)
      q.grantSendMessages(janitor)
    }

    // ---- Alarms: 8 of the 10 free ones, all single-period so they page on
    // the first bad datapoint, all quiet when there is no data at all.
    const topic = new sns.Topic(this, 'Alarms')
    // Without -c alarmEmail (or CONTACT_EMAIL) the alarms have no subscriber
    // and page nobody; the deploy runbook passes it explicitly.
    if (contactEmail) topic.addSubscription(new subs.EmailSubscription(contactEmail))
    const page = new cwActions.SnsAction(topic)
    const alarm = (alarmId: string, metric: cloudwatch.Metric, threshold: number): void => {
      new cloudwatch.Alarm(this, alarmId, {
        metric,
        threshold,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(page)
    }
    alarm('DlqNotEmpty', dlq.metricApproximateNumberOfMessagesVisible({ statistic: 'Maximum' }), 1)
    alarm('WorkerErrors', worker.metricErrors({ statistic: 'Sum' }), 1)
    alarm('ApiErrors', api.metricErrors({ statistic: 'Sum' }), 1)
    alarm('JanitorErrors', janitor.metricErrors({ statistic: 'Sum' }), 1)
    alarm('DlqConsumerErrors', dlqConsumer.metricErrors({ statistic: 'Sum' }), 1)
    // The home-box container worker has no cloud heartbeat; a task sitting an
    // hour on its queue is the "worker is down" signal.
    alarm(
      'ContainerQueueStalled',
      containerQueue.metricApproximateAgeOfOldestMessage({ statistic: 'Maximum' }),
      3600,
    )
    alarm('TableReadThrottled', table.metric('ReadThrottleEvents', { statistic: 'Sum' }), 1)
    alarm('TableWriteThrottled', table.metric('WriteThrottleEvents', { statistic: 'Sum' }), 1)
  }
}
