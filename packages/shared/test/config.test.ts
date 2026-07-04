import { expect, test } from 'vitest'
import { BRAND_NAME } from '../src/config.js'

test('brand name is a lowercase slug usable in URLs and package names', () => {
  expect(BRAND_NAME).toMatch(/^[a-z][a-z0-9-]*$/)
})
