import { Stack, type StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'

export class BlunderfarmStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    // Resources arrive per phase: table and queues in Phase 2 parity,
    // ingest and worker Lambdas in Phase 5.
  }
}
