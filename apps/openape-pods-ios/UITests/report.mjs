import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

export async function nativeReport(results) {
  assert.deepEqual(results.map(item => item.family).sort(), ['iPad', 'iPhone'])
  const directory = '.artifacts/native-acceptance'
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const source = JSON.parse(await readFile('.artifacts/native-source.json', 'utf8'))
  const tests = []
  for (const { family, path } of results) {
    const summary = JSON.parse((await execute('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', path, '--compact'])).stdout)
    assert.equal(summary.failedTests, 0)
    assert.equal(summary.passedTests, 2)
    const evidence = JSON.parse(await readFile(`.artifacts/${family}-native-flow.json`, 'utf8'))
    assert.equal(evidence.family, family)
    assert.equal(evidence.approvedGrants.length, 2)
    const exported = join(directory, family)
    await execute('xcrun', ['xcresulttool', 'export', 'attachments', '--path', path, '--output-path', exported, '--filter', '*.png'])
    const attachments = JSON.parse(await readFile(join(exported, 'manifest.json'), 'utf8')).flatMap(test => test.attachments)
    const steps = []
    for (const title of ['Native exact script review', 'Waiting for original IdP grant', 'Native shared desktop result', 'Same result after desktop restart', 'Revoked device refused']) {
      const attachment = attachments.find(item => item.suggestedHumanReadableName.startsWith(title))
      assert.ok(attachment, `Missing ${family} evidence: ${title}`)
      steps.push({ title, shot: `${family}/${attachment.exportedFileName}`, status: 'passed' })
    }
    const desktop = `${family}/desktop-result.png`
    await copyFile(`.artifacts/${family}-desktop-result.png`, join(directory, desktop))
    steps.push({ title: 'The same completed run is visible on desktop', shot: desktop, status: 'passed' })
    tests.push({ id: family.toLowerCase(), title: `${family}: create, chat, authorize and inspect the desktop result`, status: 'passed', description: `Actual native UI, disposable Free-IdP SQLite storage, encrypted relay and packaged Electron runtime. The harmless installed CLI produces a unique result after explicit desktop command authorization and the original-IdP run approval. The app and the desktop are then restarted and still show the same run; after the desktop removes the pairing, a further run is refused without creating a new run and the app returns to pairing. Command permission setup currently requires the desktop. A recorded model prepares the script; no live LLM or owner profile is used. Run: ${evidence.runId}.`, steps })
  }
  const manifest = { title: 'Native mobile Pods — integrated acceptance', project: 'OpenApe Pods / issue 1362', summary: `iPhone and iPad Simulator proof with real authentication, provisioning and grant enforcement. Production HTTPS app association, physical devices and Apple distribution remain separate release gates. Source base: ${source.head}; working changes SHA-256: ${source.workingChangesSHA256}.`, tests }
  await writeFile(join(directory, 'testrun.json'), JSON.stringify(manifest, null, 2))
  const cards = []
  for (const test of tests) {
    const images = []
    for (const step of test.steps) {
      const bytes = await readFile(join(directory, step.shot))
      images.push(`<figure><img src="data:image/png;base64,${bytes.toString('base64')}" alt="${escape(step.title)}"><figcaption>${escape(step.title)}</figcaption></figure>`)
    }
    cards.push(`<section><h2>${escape(test.title)}</h2><p>${escape(test.description)}</p><div class="shots">${images.join('')}</div></section>`)
  }
  await writeFile(join(directory, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(manifest.title)}</title><style>body{font:16px/1.6 system-ui;margin:0;background:#f4f5fa;color:#172034}main{max-width:1280px;margin:auto;padding:32px}section{background:white;border:1px solid #dce0eb;border-radius:20px;padding:24px;margin:24px 0}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}figure{margin:0}img{max-width:100%;height:auto;border-radius:12px;border:1px solid #dce0eb}figcaption{font-size:14px;padding-top:8px}.passed{color:#176e3c;font-weight:700}</style><main><p class="passed">Both native simulator flows passed</p><h1>${escape(manifest.title)}</h1><p>${escape(manifest.summary)}</p><p>Register desktop → native sign-in → key pairing → remote Pod → real agent provisioning → program review → chat → script review → original-IdP approvals → desktop execution → shared result.</p>${cards.join('')}</main></html>`)
  return directory
}
