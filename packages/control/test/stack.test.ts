import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { beforeAll, expect, test } from 'vitest'
import { ForkedStack } from '../lib/stack.js'

// The empty bundling-stacks context skips ALL asset bundling, so these tests
// need neither Docker nor esbuild.
let template: Template

beforeAll(() => {
  const app = new App({
    context: { 'aws:cdk:bundling-stacks': [], alarmEmail: 'alarm@example.com' },
  })
  template = Template.fromStack(new ForkedStack(app, 'Forked'))
})

test('table is provisioned at exactly the 25/25 free tier with TTL, retained', () => {
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    ProvisionedThroughput: { ReadCapacityUnits: 20, WriteCapacityUnits: 20 },
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    GlobalSecondaryIndexes: [
      Match.objectLike({
        IndexName: 'gsi1',
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        // ALL would replicate every job-counter update into the GSI.
        Projection: Match.objectLike({ ProjectionType: 'INCLUDE' }),
      }),
    ],
  })
  template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' })
})

test('three queues; both work queues redrive to the one DLQ at 5 receives', () => {
  template.resourceCountIs('AWS::SQS::Queue', 3)
  template.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: 'analysis-tasks',
    VisibilityTimeout: 180,
    RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
  })
  template.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: 'analysis-tasks-lambda',
    VisibilityTimeout: 5400, // 6x the 900s worker timeout
    RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
  })
})

test('worker: image function at 1769MB/900s, event source capped at concurrency 5', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    PackageType: 'Image',
    MemorySize: 1769,
    Timeout: 900,
  })
  template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    BatchSize: 1,
    ScalingConfig: { MaximumConcurrency: 5 },
    FunctionResponseTypes: ['ReportBatchItemFailures'],
  })
})

test('no function reserves concurrency (that would prematurely dead-letter)', () => {
  for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
    expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined()
  }
})

test('api is a public Function URL with CORS; API Gateway never appears', () => {
  template.hasResourceProperties('AWS::Lambda::Url', {
    AuthType: 'NONE',
    Cors: Match.objectLike({ AllowOrigins: ['*'] }),
  })
  const types = Object.values(template.toJSON().Resources as Record<string, { Type: string }>).map(
    (r) => r.Type,
  )
  expect(types.filter((t) => t.startsWith('AWS::ApiGateway'))).toEqual([])
})

test('janitor runs on a 10-minute EventBridge Scheduler rate', () => {
  template.hasResourceProperties('AWS::Scheduler::Schedule', {
    ScheduleExpression: 'rate(10 minutes)',
  })
})

test('dlq consumer drains in batches of 10', () => {
  template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    BatchSize: 10,
    FunctionResponseTypes: ['ReportBatchItemFailures'],
  })
})

test('exactly 8 alarms (10 are free), all single-period, all paging the topic', () => {
  template.resourceCountIs('AWS::CloudWatch::Alarm', 8)
  for (const a of Object.values(template.findResources('AWS::CloudWatch::Alarm'))) {
    expect(a.Properties.EvaluationPeriods).toBe(1)
    expect(a.Properties.TreatMissingData).toBe('notBreaching')
    expect(a.Properties.AlarmActions).toHaveLength(1)
  }
  template.resourceCountIs('AWS::SNS::Topic', 1)
  template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email' })
})
