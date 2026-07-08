import { App } from 'aws-cdk-lib'
import { ForkedStack } from '../lib/stack.js'

const app = new App()
new ForkedStack(app, 'Forked')
