import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { expect, test } from 'vitest'
import { BlunderfarmStack } from '../lib/stack.js'

test('stack synthesizes without errors', () => {
  const app = new App()
  const stack = new BlunderfarmStack(app, 'Blunderfarm')
  const template = Template.fromStack(stack)
  expect(template.toJSON()).toBeDefined()
})
