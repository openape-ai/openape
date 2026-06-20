import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  vue: true,
  ignores: [
    '**/dist/**',
    '**/.nuxt/**',
    '**/.output/**',
    '**/.turbo/**',
    '**/.data/**',
    '**/target/**',
    '**/*.md',
    '**/*.toml',
    '**/*.json',
    '**/*.d.ts',
    '**/*.d.vue.ts',
    '**/*.vue.d.ts',
    '**/*.generated.ts',
    '**/modules/*/src/runtime/**/*.js',
  ],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'no-new': 'off',
    'no-console': 'off',
    'no-alert': 'off',
    'unused-imports/no-unused-imports': 'error',
    'import/no-duplicates': 'error',
    'regexp/no-super-linear-backtracking': 'error',
    'unicorn/prefer-number-properties': 'error',
    'e18e/prefer-array-at': 'error',
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'style/max-statements-per-line': 'off',
    'style/no-multi-spaces': 'off',
    'style/quote-props': 'off',
    'style/operator-linebreak': 'off',
    'style/indent-binary-ops': 'off',
    'style/padded-blocks': 'off',
    'style/member-delimiter-style': 'off',
    'antfu/if-newline': 'off',
    'antfu/consistent-list-newline': 'off',
    'perfectionist/sort-imports': 'off',
    'perfectionist/sort-named-imports': 'off',
    'perfectionist/sort-named-exports': 'off',
    'perfectionist/sort-exports': 'off',
    'jsonc/sort-keys': 'off',
    'markdown/fenced-code-language': 'off',
    'toml/array-bracket-spacing': 'off',
    'toml/array-element-newline': 'off',
    'e18e/prefer-static-regex': 'off',
    'e18e/prefer-spread-syntax': 'off',
    'space-in-parens': 'off',
    'vue/comma-dangle': 'off',
    'vue/space-infix-ops': 'off',
    'e18e/prefer-array-fill': 'off',
    'test/prefer-lowercase-title': 'off',
  },
}).append({
  // Client code must not import server-only modules. Nuxt splits app/ and
  // server/ into separate tsconfigs, so an app→server import otherwise only
  // surfaces at CI typecheck with a cryptic TS2307. Catch it here at lint time.
  // Isomorphic data belongs in shared/ (importable via #shared from both sides).
  files: ['apps/*/app/**/*.{ts,tsx,vue,js,mjs}'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/server/**', '#server/**', '~/server/**', '~~/server/**'],
        message: 'Client code must not import from server/. Move shared data to the app\'s shared/ folder (import via #shared), or fetch it through a server/api route.',
      }],
    }],
  },
})
