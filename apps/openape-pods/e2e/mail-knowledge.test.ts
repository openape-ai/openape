import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { extractSource } from '../src/worker/mail/extraction'
import type { AgentRuntime } from '../src/worker/agent/executor'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
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
// Formats and gap classification are unit-tested in test/mail/extraction.test.ts.
// This run proves the parser executes in the sandbox with the packaged runtime.
it('mail-knowledge: extracts a PDF source in the native parser of the packaged app', async () => {
  const config = await runtime(true)
  const domains: string[] = []
  const source = Buffer.from(JSON.stringify({ data: { contentType: 'application/pdf', contentBytes: pdf('Delivery is June 8.').toString('base64') } }))
  const result = await extractSource(config, root, source, new AbortController().signal, (path) => { domains.push(path) })
  expect(result.gap).toBeNull(); expect(result.text).toContain('Delivery is June 8.')
  expect(domains).toHaveLength(1)
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
