import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  ignores: [
    '**/dist/**',
    '**/.nuxt/**',
    '**/.output/**',
    '**/.turbo/**',
    '**/.data/**',
    '**/target/**',
  ],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'no-new': 'off',
  },
})
