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

// Explicit types so the guide pages typecheck even when the manifest is empty
// (an empty `categories: []` would otherwise infer as never[]).
const out = `// AUTO-GENERATED from docs/stories.json by scripts/build-docs.mjs — do not edit.
interface DocStep { title: string, html: string, shot: string | null }
interface DocStory { id: string, title: string, introHtml: string, steps: DocStep[] }
interface DocCategory { title: string, stories: DocStory[] }
interface DocsGuide { categories: DocCategory[] }
export const docsGuide: DocsGuide = ${JSON.stringify({ categories })}
`
writeFileSync(join(appRoot, 'app', 'docs.generated.ts'), out)
console.log(`[build-docs] wrote app/docs.generated.ts (${categories.length} categories, ${stories.length} stories)`)
