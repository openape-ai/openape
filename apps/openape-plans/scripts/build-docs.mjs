// Render docs/stories.json (written by compose/distribute-docs.mjs from the
// E2E story manifests) → app/docs.generated.ts for the /docs guide pages.
// Committed so the app build never depends on a capture run.
//
// Emits:
//   docsGuide = { categories: [{ title, stories: [{ id, title, introHtml,
//                 steps: [{ title, html, shot }] }] }] }
// Story intros/captions are markdown (links, **bold**, `code`).
//
//   node scripts/build-docs.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const { stories } = JSON.parse(readFileSync(join(appRoot, 'docs', 'stories.json'), 'utf8'))

const categories = []
for (const s of [...stories].sort((a, b) => a.order - b.order)) {
  let cat = categories.find(c => c.title === s.category)
  if (!cat) {
    cat = { title: s.category, stories: [] }
    categories.push(cat)
  }
  cat.stories.push({
    id: s.id,
    title: s.title,
    introHtml: marked.parse(s.intro ?? '', { gfm: true }),
    steps: s.steps.map(st => ({
      title: st.title,
      html: marked.parseInline(st.caption ?? '', { gfm: true }),
      shot: st.shot ? `/docs/screenshots/${st.shot}` : null,
    })),
  })
}

const out = `// AUTO-GENERATED from docs/stories.json by scripts/build-docs.mjs — do not edit.\n`
  + `export const docsGuide = ${JSON.stringify({ categories })}\n`
writeFileSync(join(appRoot, 'app', 'docs.generated.ts'), out)
console.log(`[build-docs] wrote app/docs.generated.ts (${categories.length} categories, ${stories.length} stories)`)
