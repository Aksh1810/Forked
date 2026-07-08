import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/shared',
      'packages/worker',
      {
        test: {
          root: 'packages/control',
          name: 'packages/control',
          // cdk.out stages full repo copies (including test files) for Lambda assets
          exclude: [...defaultExclude, '**/cdk.out/**'],
        },
      },
    ],
  },
})
