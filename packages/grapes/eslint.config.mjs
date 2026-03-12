import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  ignores: [
    '**/dist/**',
    '**/*.md',
    '**/*.toml',
    '**/*.json',
  ],
  rules: {
    'node/prefer-global/process': 'off',
    'no-console': 'off',
    'antfu/if-newline': 'off',
    'antfu/top-level-function': 'off',
    'style/brace-style': 'off',
    'perfectionist/sort-imports': 'off',
    'perfectionist/sort-named-imports': 'off',
    'perfectionist/sort-named-exports': 'off',
    'perfectionist/sort-exports': 'off',
    'import/no-duplicates': 'off',
    'unused-imports/no-unused-imports': 'off',
  },
})
