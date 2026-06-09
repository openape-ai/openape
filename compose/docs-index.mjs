// Render the local-stack README (the E2E-flow documentation, with its embedded
// screenshots) into a self-contained docs/local-stack/index.html, which the
// Caddy proxy serves at https://<app>.openape.test/docs. The README is the
// single source — captions/descriptions live there, next to the screenshots
// the runners capture, so the docs can't drift from the flows.
//
//   node compose/docs-index.mjs
// (the demo + agent runners call this at the end; re-run any time)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = join(here, '..', 'docs', 'local-stack')
const md = readFileSync(join(docsDir, 'README.md'), 'utf8')
const body = marked.parse(md, { gfm: true })

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenApe local stack — E2E flows</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0a0a; color: #e5e7eb;
    font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 3rem 1.25rem 6rem; }
  h1, h2, h3 { line-height: 1.25; color: #fff; }
  h1 { font-size: 2rem; margin: 0 0 1.5rem; }
  h2 { font-size: 1.4rem; margin: 2.75rem 0 1rem; padding-top: 1.5rem; border-top: 1px solid #1f2937; }
  h3 { font-size: 1.1rem; margin: 1.75rem 0 .75rem; }
  a { color: #34d399; }
  p { margin: .75rem 0; }
  img { display: block; max-width: 100%; height: auto; margin: 1rem 0;
    border: 1px solid #1f2937; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
  code { background: #111827; padding: .15em .4em; border-radius: 4px; font-size: .9em; }
  pre { background: #111827; padding: 1rem; border-radius: 8px; overflow: auto; border: 1px solid #1f2937; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .92em; }
  th, td { border: 1px solid #1f2937; padding: .5rem .7rem; text-align: left; }
  th { background: #111827; }
  hr { border: none; border-top: 1px solid #1f2937; margin: 2.5rem 0; }
  blockquote { border-left: 3px solid #374151; margin: 1rem 0; padding: .25rem 1rem; color: #9ca3af; }
  .banner { font-size: .85rem; color: #9ca3af; margin-bottom: 2rem; padding: .6rem .9rem;
    background: #111827; border: 1px solid #1f2937; border-radius: 8px; }
</style>
</head>
<body>
<main>
<div class="banner">Generated from <code>docs/local-stack/README.md</code> by the E2E runners — screenshots are captured live from the containerized stack.</div>
${body}
</main>
</body>
</html>
`

writeFileSync(join(docsDir, 'index.html'), html)
console.log(`[docs-index] wrote ${join(docsDir, 'index.html')} (${(html.length / 1024).toFixed(1)} KB)`)
