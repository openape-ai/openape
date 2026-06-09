// Render docs/flows.md → app/docs.generated.ts for the /docs page. Committed
// so the app build never depends on this running; re-run to refresh after
// editing flows.md (the local-stack E2E runner does it via
// compose/distribute-docs.mjs).
//
// Emits structured content instead of one HTML blob so the page can render a
// TOC and per-flow cards:
//   docsMeta     { title, introHtml }
//   docsSections [{ id, title, html }]   — one per `## ` heading
// Screenshots (markdown images) are wrapped in a browser-chrome <figure> with
// the alt text as caption.
//
//   node scripts/build-docs.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = readFileSync(join(appRoot, 'docs', 'flows.md'), 'utf8')

const renderer = new marked.Renderer()
renderer.image = ({ href, text }) =>
  `<figure class="shot">`
  + `<figcaption class="shot-bar"><span class="shot-dot"></span><span class="shot-dot"></span><span class="shot-dot"></span><span class="shot-label">${text}</span></figcaption>`
  + `<img src="${href}" alt="${text}" loading="lazy">`
  + `</figure>`

function render(src) {
  return marked.parse(src, { gfm: true, renderer })
}

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Everything before the first `## ` is the intro (incl. the `# ` title, which
// the page renders as the hero); each `## ` chunk becomes a section.
const chunks = md.split(/^## /m)
const head = chunks.shift() ?? ''
const titleMatch = head.match(/^# (.+)$/m)
const title = titleMatch ? titleMatch[1].trim() : 'Flows'
const introMd = head.replace(/^# .+$/m, '').trim()

const sections = chunks.map((chunk) => {
  const nl = chunk.indexOf('\n')
  const sectionTitle = chunk.slice(0, nl).trim()
  const body = chunk.slice(nl + 1).trim()
  return { id: slug(sectionTitle), title: sectionTitle, html: render(body) }
})

const out = `// AUTO-GENERATED from docs/flows.md by scripts/build-docs.mjs — do not edit.\n`
  + `export const docsMeta = ${JSON.stringify({ title, introHtml: render(introMd) })}\n`
  + `export const docsSections = ${JSON.stringify(sections)}\n`
writeFileSync(join(appRoot, 'app', 'docs.generated.ts'), out)
console.log(`[build-docs] wrote app/docs.generated.ts (${sections.length} sections)`)
