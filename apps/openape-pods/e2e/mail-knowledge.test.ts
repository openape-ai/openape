import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, expect, it } from 'vitest'
import { extractSource } from '../src/worker/mail/extraction'
import type { AgentRuntime } from '../src/worker/agent/executor'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let output = '%PDF-1.4\n'; const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(output)
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(output)
}
async function runtime(packaged: boolean): Promise<AgentRuntime> {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-mail-parser-')))
  const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
  const base = packaged ? join(bundle, 'Resources/app.asar.unpacked/dist') : resolve('dist')
  return { helper: join(base, 'native/pods-helper'), executable: packaged ? join(bundle, 'MacOS/OpenApe Pods Fixture') : process.execPath, entry: join(base, 'runtime/script-entry.mjs'), runtimeDirectories: packaged ? [await realpath(join(bundle, 'Frameworks'))] : [], environment: packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}, binary: '', catalog: '', manifest: '', sdkHost: '' }
}
for (const packaged of [false, true]) {
  it(`mail-knowledge: extracts plain/HTML/PDF/DOCX sources in the native packaged parser (packaged=${packaged})`, async () => {
    const config = await runtime(packaged)
    const documents = [
      { type: 'text/plain', bytes: Buffer.from('Delivery is June 8.'), expected: 'Delivery is June 8.' },
      { type: 'text/html', bytes: Buffer.from('<p>Delivery is <b>June 8</b>.</p><script>stealSecrets()</script><img src="https://attacker.invalid/tracking">'), expected: 'Delivery is June 8.' },
      { type: 'application/pdf', bytes: pdf('Delivery is June 8.'), expected: 'Delivery is June 8.' },
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Delivery is June 8.</w:t></w:r></w:p></w:body></w:document>') })), expected: 'Delivery is June 8.' },
    ]
    const domains: string[] = []
    for (const document of documents) {
      const source = Buffer.from(JSON.stringify({ data: { contentType: document.type, contentBytes: document.bytes.toString('base64') } }))
      const result = await extractSource(config, root, source, new AbortController().signal, (path) => { domains.push(path) })
      expect(result.gap, document.type).toBeNull(); expect(result.text).toContain(document.expected)
      expect(result.text).not.toContain('stealSecrets'); expect(result.text).not.toContain('attacker.invalid')
    }
    expect(domains).toHaveLength(4)
  })
}
it('mail-knowledge: unsupported, scanned, malformed and oversized documents remain explicit gaps', async () => {
  const config = await runtime(false)
  const documents = [
    { type: 'application/octet-stream', bytes: Buffer.from('unsupported') },
    { type: 'application/pdf', bytes: pdf('') },
    { type: 'application/pdf', bytes: Buffer.from('broken PDF') },
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from(zipSync({ 'word/document.xml': strToU8(`<w:document>${'a'.repeat(3 * 1024 * 1024)}</w:document>`) })) },
  ]
  for (const document of documents) {
    const result = await extractSource(config, root, Buffer.from(JSON.stringify({ data: { contentType: document.type, contentBytes: document.bytes.toString('base64') } })), new AbortController().signal, () => {})
    expect(result.gap).toBeTruthy(); expect(result.text).toBe('')
  }
})

it('mail-knowledge: runs the versioned recipe through the actual script, SDK and parser without duplicating committed evidence', async () => {
  const { PodDatabase, digest } = await import('../src/worker/storage/database')
  const { ResourceRegistry } = await import('../src/worker/resources/registry')
  const { RunDispatcher } = await import('../src/worker/runs/dispatcher')
  const { installMailRecipe } = await import('../src/worker/mail/install')
  const { ingestMailPage } = await import('../src/worker/mail/ingestion')
  const { parseMailRequest } = await import('../src/main/mail/contract')
  const { recordedResponse } = await import('./fixtures/responses')
  const { randomUUID } = await import('node:crypto')
  const { readFile, writeFile } = await import('node:fs/promises')
  const config = await runtime(false)
  Object.assign(config, { binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') })
  const store = new PodDatabase(root); const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Golden mail pod' })
  const connectionId = randomUUID()
  const scope = { account: 'synthetic@example.invalid', folders: ['rules'], attachments: false }
  for (const [kind, configuration] of [
    ['tool', { ...scope, capability: 'mail.read', connectionId, grants: { messages: 'synthetic-grant' } }],
    ['connection', { provider: 'microsoft', account: scope.account, connectionId }],
    ['connection', { provider: 'openape', identity: { connectionId: randomUUID(), podId: pod.id, issuer: 'https://identity.example.invalid', owner: 'owner@example.invalid', subject: 'agent@example.invalid', keyId: 'synthetic-key' } }],
  ] as const) store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), pod.id, kind, 'ready', 'Synthetic assignment', JSON.stringify(configuration))
  let providerCalls = 0; let reads = 0
  const dispatcher = new RunDispatcher(store, resources, config, {
    tool: async (body, _signal, lease) => {
      const request = parseMailRequest(body, scope).read; reads++
      const data = JSON.stringify({ version: 1, operation: 'messages', account: scope.account, folder: request.folder, complete: true, items: [{ id: 'golden-message', changeKey: 'v1', conversationId: 'golden-conversation', parentFolderId: 'rules', body: { contentType: 'text', content: 'Delivery is confirmed for June 8.' } }] })
      const path = join(lease.root, `mail-${randomUUID()}.json`); await writeFile(path, data)
      return ingestMailPage(store, pod.id, lease.root, { path, hash: digest(data) }, scope, request, lease.assertCurrent)
    },
    provider: async (body) => {
      providerCalls++; expect(JSON.stringify(body)).toContain('UNTRUSTED_CONTEXT')
      const context = JSON.parse(store.db.prepare('SELECT body FROM mail_contexts ORDER BY rowid DESC LIMIT 1').get()!.body as string)
      const answer = JSON.stringify({ claims: [{ kind: 'finding', text: 'Delivery is confirmed for June 8', evidence: [{ sourceId: context.evidence[0].id, quote: 'Delivery is confirmed for June 8.' }] }] })
      return recordedResponse({ type: 'message', id: 'golden-answer', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer, annotations: [] }] })
    },
  })
  try {
    installMailRecipe(store, resources, pod.id, JSON.parse(await readFile(config.manifest, 'utf8')).dependencyLockHash)
    const first = dispatcher.start(pod.id)
    await expect.poll(() => dispatcher.runs.get(first).state, { timeout: 15000 }).toBe('completed')
    expect(store.knowledge(pod.id)).toHaveLength(1)
    const second = dispatcher.start(pod.id)
    await expect.poll(() => dispatcher.runs.get(second).state, { timeout: 15000 }).toBe('completed')
    expect(store.knowledge(pod.id)).toHaveLength(1); expect(providerCalls).toBe(1); expect(reads).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM mail_receipts').get()!.count).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM run_leases').get()!.count).toBe(0)
  }
  finally { await dispatcher.stop(); store.close() }
})
