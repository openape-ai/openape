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
    'style/max-statements-per-line': 'off',
    'style/no-multi-spaces': 'off',
    'style/quote-props': 'off',
    'style/operator-linebreak': 'off',
    'style/indent-binary-ops': 'off',
    'style/padded-blocks': 'off',
    'style/member-delimiter-style': 'off',
    'antfu/if-newline': 'off',
    // A list stays on one line or puts every item on its own line.
    'antfu/consistent-list-newline': 'error',
    'style/object-curly-newline': ['error', { multiline: true, consistent: true }],
    'style/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
    'style/array-bracket-newline': ['error', 'consistent'],
    'style/function-paren-newline': ['error', 'consistent'],
    'style/function-call-argument-newline': ['error', 'consistent'],
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
}).append({
  // Issue 1473, revision 4: the Pods desktop is a generic runtime and only the IdP knows Shapes. Desktop code never
  // imports a Shapes resolver or adapter loader; a wording or adapter change must never need a signed desktop build.
  files: ['apps/openape-pods/src/**/*.{ts,tsx,vue,js,mjs}'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: '@openape/apes', message: 'The Pods desktop sends program calls to the IdP (POST /api/grants/authorize); it never loads Shapes adapters or resolves commands.' },
        { name: '@openape/shapes', message: 'The Pods desktop sends program calls to the IdP (POST /api/grants/authorize); it never loads Shapes adapters or resolves commands.' },
        { name: '@openape/grants', importNames: ['resolveServerShape', 'matchArgvToOperation', 'buildCliAuthDetail', 'createInMemoryShapeStore', 'parseShapePresentation', 'parseShapeCliVersions', 'readCliVersion', 'presentationBindings', 'GENERIC_OPERATION_ID'], message: 'Shapes resolution belongs to the IdP; the Pods desktop only verifies the command token it returns.' },
      ],
      patterns: [{ group: ['@openape/apes/*', '@openape/shapes/*'], message: 'The Pods desktop never loads Shapes adapters or resolves commands; the IdP does.' }],
    }],
    // Issue 1475: the model comes from the connected ChatGPT account at runtime; a model change at OpenAI must
    // never need a desktop code change or signed build. The first two selectors repeat the shared defaults.
    'no-restricted-syntax': ['error', 'TSEnumDeclaration[const=true]', 'TSExportAssignment', ...['Literal[value=/(^|[^A-Za-z])gpt-/]', 'TemplateElement[value.raw=/(^|[^A-Za-z])gpt-/]'].map(selector => ({ selector, message: 'Do not hard-code a model slug in the Pods desktop; use the connected account\'s default model (src/worker/agent/model.ts).' }))],
  },
})
