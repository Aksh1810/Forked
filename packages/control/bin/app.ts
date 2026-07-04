import { App } from 'aws-cdk-lib'
import { BlunderfarmStack } from '../lib/stack.js'

const app = new App()
new BlunderfarmStack(app, 'Blunderfarm')
