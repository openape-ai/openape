#!/usr/bin/env node
// Render a captured scenario into a single self-contained HTML how-to guide:
// per step, the CLI command + output side by side with the browser screenshot
// at three viewports (desktop / tablet / mobile). Screenshots are inlined as
// data URIs so the file is forwardable on its own.
//
//   node scripts/build-guide.mjs <scenario.json> <out.html>
//
// Input shape (see e2e/scenarios/*.ts for the spec the captors emit):
//   { title, intro?, steps: [{ key, caption,
//       cli?:    { command, output },
//       browser?:{ desktop?, tablet?, mobile? }  // base64 PNG (no data: prefix)
//   }] }
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: node scripts/build-guide.mjs <scenario.json> <out.html>')
  process.exit(1)
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const guide = JSON.parse(readFileSync(inPath, 'utf8'))
const VIEWPORTS = ['desktop', 'tablet', 'mobile']

function shotTabs(browser, key) {
  const present = VIEWPORTS.filter(v => browser?.[v])
  if (!present.length) return '<p class="muted">— no screenshot —</p>'
  const tabs = present.map((v, i) =>
    `<button class="vp${i === 0 ? ' on' : ''}" data-key="${key}" data-vp="${v}">${v}</button>`).join('')
  const imgs = present.map((v, i) =>
    `<img class="shot${i === 0 ? ' on' : ''}" data-key="${key}" data-vp="${v}" alt="${esc(v)} screenshot" src="data:image/png;base64,${browser[v]}">`).join('')
  return `<div class="vpbar">${tabs}</div><div class="shots">${imgs}</div>`
}

function stepCard(step, i) {
  const hasBrowser = VIEWPORTS.some(v => step.browser?.[v])
  const cli = step.cli
    ? `<div class="col"><div class="lbl">CLI</div><pre class="sh"><span class="prompt">$</span> ${esc(step.cli.command)}\n<span class="out">${esc(step.cli.output)}</span></pre></div>`
    : ''
  const browser = hasBrowser
    ? `<div class="col"><div class="lbl">Browser</div>${shotTabs(step.browser, step.key)}</div>`
    : ''
  return `<section class="step">
    <div class="num">${i + 1}</div>
    <div class="body">
      <p class="cap">${esc(step.caption)}</p>
      <div class="cols${hasBrowser ? '' : ' solo'}">${cli}${browser}</div>
    </div>
  </section>`
}

const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(guide.title)}</title>
<style>
  :root { --bg:#0b0d10; --card:#15181d; --line:#262b33; --fg:#e6e9ee; --muted:#8b94a3; --accent:#5b9dff; --sh:#0d1117; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --card:#fff; --line:#e3e6ea; --fg:#1a1d22; --muted:#6b727f; --accent:#2563eb; --sh:#0d1117; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 28px; margin:0 0 6px; }
  .intro { color: var(--muted); margin: 0 0 32px; }
  .step { display:flex; gap:16px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin:0 0 18px; }
  .num { flex:0 0 30px; height:30px; border-radius:50%; background:var(--accent); color:#fff; display:grid; place-items:center; font-weight:600; }
  .body { flex:1; min-width:0; }
  .cap { margin:2px 0 16px; font-size:16px; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .cols.solo { grid-template-columns:1fr; }
  @media (max-width:720px) { .cols { grid-template-columns:1fr; } }
  .lbl { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:6px; }
  pre.sh { background:var(--sh); color:#d6deeb; border-radius:8px; padding:12px 14px; overflow-x:auto; font:13px/1.5 'SF Mono',Menlo,monospace; margin:0; white-space:pre-wrap; }
  .prompt { color:#5b9dff; } .out { color:#9aa7b8; }
  .vpbar { display:flex; gap:6px; margin-bottom:8px; }
  .vp { background:transparent; border:1px solid var(--line); color:var(--muted); border-radius:6px; padding:3px 10px; font-size:12px; cursor:pointer; text-transform:capitalize; }
  .vp.on { border-color:var(--accent); color:var(--accent); }
  .shots img { display:none; width:100%; border:1px solid var(--line); border-radius:8px; }
  .shots img.on { display:block; }
  .muted { color:var(--muted); }
  footer { color:var(--muted); font-size:12px; margin-top:40px; text-align:center; }
</style></head>
<body><div class="wrap">
  <h1>${esc(guide.title)}</h1>
  ${guide.intro ? `<p class="intro">${esc(guide.intro)}</p>` : ''}
  ${(guide.steps || []).map(stepCard).join('\n')}
  <footer>Generiert aus dem E2E-Lauf — nicht von Hand bearbeiten. <code>node scripts/build-guide.mjs</code></footer>
</div>
<script>
  document.querySelectorAll('.vp').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.key, vp = b.dataset.vp;
    document.querySelectorAll('.vp[data-key="'+key+'"]').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.shot[data-key="'+key+'"]').forEach(img => img.classList.toggle('on', img.dataset.vp === vp));
  }));
</script>
</body></html>`

writeFileSync(outPath, html)
console.log(`guide: ${guide.steps?.length || 0} steps → ${outPath} (${(html.length / 1024).toFixed(0)} KB)`)
