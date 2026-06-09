// Render docs/flows.md → app/docs.generated.ts (an importable HTML string the
// /docs page renders). Committed so the app build never depends on this running;
// re-run to refresh after editing flows.md (the local-stack E2E runner does it,
// and it's wired as a `prebuild` step). A plain `.ts` export — no Vite `?raw`
// magic, no markdown runtime dependency in the app bundle.
//
//   node scripts/build-docs.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = readFileSync(join(appRoot, 'docs', 'flows.md'), 'utf8')
const html = marked.parse(md, { gfm: true })

const out = `// AUTO-GENERATED from docs/flows.md by scripts/build-docs.mjs — do not edit.\n`
  + `export const docsHtml = ${JSON.stringify(html)}\n`
writeFileSync(join(appRoot, 'app', 'docs.generated.ts'), out)
console.log('[build-docs] wrote app/docs.generated.ts')
