// @vitest-environment node
import { chmod, mkdtemp, readFile, realpath, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { parseAgentRequest, agentModelSizes, agentThinkingLevels } from '../../src/contracts/agent'
import type { ProxyAgentRequest } from '../../src/contracts/agent'
import type { ModelApiSave } from '../../src/contracts/model-api'
import { parseModelApiSave } from '../../src/contracts/model-api'
import { configurationHash } from '../../src/main/agent-backends/config'
import { AgentBackendManager } from '../../src/main/agent-backends/manager'
import { defaultModelApiConfig, parseModelApiConfig, resolveLatestRequest } from '../../src/main/agent-backends/model-config'
import { latestModel } from '../../src/main/agent-backends/families'
import { readModelCatalog } from '../../src/main/agent-backends/catalog'
import { normalizeProxyResponse, proxyPayload } from '../../src/main/agent-backends/transport'
import { assertPrivatePath, modelSecretDirectory, readConnectionKey, saveModelApiSettings } from '../../src/main/agent-backends/settings-store'
import { approvedAgentBackendConfig } from './agent-backend-fixture'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function profile() { const root = await realpath(await mkdtemp(join(tmpdir(), 'model-api-'))); roots.push(root); return root }
function request(extra: object = {}): ProxyAgentRequest { return parseAgentRequest({ backend: 'proxy', provider: 'codex', modelSize: 'large', prompt: 'fixture', ...extra }) as ProxyAgentRequest }
function settings(): ModelApiSave { const config = defaultModelApiConfig(); return { expectedHash: null, connections: { openai: { ...config.connections.openai, enabled: true }, anthropic: { ...config.connections.anthropic, enabled: true } } } }
function edit(): ModelApiSave { const value = settings(); for (const id of ['openai', 'anthropic'] as const) { const { id: _id, ...entry } = value.connections[id] as typeof value.connections[typeof id] & { id?: string }; value.connections[id] = entry } return value }
const catalog = (ids: string[]) => ({ entries: ids.map(id => ({ id, max_tokens: 128000 })), hash: 'a'.repeat(64), checkedAt: new Date().toISOString() })
const reply = (model: string) => ({ id: 'resp-1', model, status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'not-visible' }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'answer' }] }], usage: { input_tokens: 4, output_tokens: 2, output_tokens_details: { reasoning_tokens: 1 } } })

it('orders latest versions numerically, excludes foreign providers and refuses ambiguous aliases', () => {
  expect(latestModel(catalog(['claude-opus-5-9', 'claude-opus-5-10', 'claude-opus-6-beta']).entries, 'claude', 'large').entry.id).toBe('claude-opus-5-10')
  expect(latestModel(catalog(['gpt-6.1-sol', 'gpt-6.2-sol']).entries, 'codex', 'large').entry.id).toBe('gpt-6.2-sol')
  expect(latestModel(catalog(['claude-haiku-4-5-20251001', 'claude-haiku-5-5']).entries, 'claude', 'small').entry.id).toBe('claude-haiku-5-5')
  expect(latestModel([{ id: 'claude-fable-5-1', owned_by: 'anthropic' }, { id: 'claude-fable-5-dd-anul-6-tpg', owned_by: 'openai' }], 'claude', 'xlarge').entry.id).toBe('claude-fable-5-1')
  for (const id of ['claude-opus-latest', 'claude-opus-new-release']) expect(() => latestModel(catalog(['claude-opus-5-5', id]).entries, 'claude', 'large')).toThrow('cannot be determined')
  expect(() => latestModel(catalog(['gpt-6-sol', 'gpt-6.0-sol']).entries, 'codex', 'large')).toThrow('ambiguous')
})

it('migrates legacy pins to families without changing credentials or accepting fixed schema-2 IDs', () => {
  const old = approvedAgentBackendConfig('/private/key.json'); const config = parseModelApiConfig(old)
  expect(config.connections.openai).toMatchObject({ format: 'chat-completions', credential: { type: 'external', path: '/private/key.json' } })
  expect(JSON.stringify(config.models)).not.toMatch(/modelId|gpt-6|claude-haiku-4/)
  const resolved = resolveLatestRequest(config, request({ provider: 'claude', modelSize: 'small' }), catalog(['claude-haiku-4-5-20251001', 'claude-haiku-5-5']))
  expect(resolved.model.modelId).toBe('claude-haiku-5-5')
  expect(() => parseModelApiConfig({ ...config, models: { ...config.models, codex: { small: { ...config.models.codex.small, modelId: 'gpt-6-luna' } } } })).toThrow()
  expect(() => parseModelApiSave({ ...edit(), fixedVersion: 'gpt-6-sol' })).toThrow()
})

it('serializes all sizes and thinking levels for both OpenAI formats and validates Responses items', () => {
  const config = defaultModelApiConfig(); config.connections.openai.enabled = true
  const ids = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-6.1-sol', 'gpt-6-astra']
  for (const format of ['chat-completions', 'responses'] as const) {
    config.connections.openai.format = format
    for (const modelSize of agentModelSizes) {
      for (const thinking of agentThinkingLevels) {
        const input = request({ modelSize, thinking }); const snapshot = resolveLatestRequest(config, input, catalog(ids)); const payload = proxyPayload(snapshot, input)
        expect(payload).toMatchObject({ tools: [], tool_choice: 'none', stream: false, model: snapshot.model.modelId })
        if (format === 'responses') {
          expect(payload).toMatchObject({ reasoning: { effort: thinking }, store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }] })
          expect(normalizeProxyResponse(reply(snapshot.model.modelId), snapshot)).toMatchObject({ response: 'answer', usage: { source: 'responses.usage', input: 4, output: 2, reasoning: 1 } })
          for (const output of [[{ type: 'function_call' }], [{ type: 'image_generation_call' }], [{ type: 'message', role: 'assistant', status: 'in_progress', content: [] }]]) expect(() => normalizeProxyResponse({ ...reply(snapshot.model.modelId), output }, snapshot)).toThrow()
          expect(() => normalizeProxyResponse({ ...reply(snapshot.model.modelId), status: 'incomplete' }, snapshot)).toThrow('incomplete')
        }
        else {
          expect(payload).toMatchObject({ reasoning_effort: thinking })
        }
      }
    }
  }
})

it('writes private tokens atomically, preserves external keys, rejects stale writes and repeats without effects', async () => {
  const root = await profile(); const key = join(root, 'external.json'); await writeFile(key, '{"api_key":"fixture-only"}', { mode: 0o600 })
  const old = approvedAgentBackendConfig(key); await writeFile(join(root, 'agent-backends.json'), JSON.stringify(old), { mode: 0o600 })
  const migrated = parseModelApiConfig(old); const input = edit(); input.expectedHash = configurationHash(migrated)
  for (const id of ['openai', 'anthropic'] as const) input.connections[id].authentication = 'token'
  input.connections.openai.token = 'new-synthetic-token'
  const saved = await saveModelApiSettings(root, input)
  expect(await readFile(key, 'utf8')).toBe('{"api_key":"fixture-only"}')
  expect(saved.connections.anthropic.credential).toEqual({ type: 'external', path: key })
  expect(JSON.stringify(saved)).not.toContain('new-synthetic-token')
  const privateFiles = await readdir(modelSecretDirectory(root))
  for (const file of privateFiles) expect((await stat(join(modelSecretDirectory(root), file))).mode & 0o777).toBe(0o600)
  expect((await stat(modelSecretDirectory(root))).mode & 0o777).toBe(0o700)
  await expect(saveModelApiSettings(root, input)).rejects.toThrow('changed')
  delete input.connections.openai.token; input.expectedHash = configurationHash(saved)
  expect(await saveModelApiSettings(root, input)).toEqual(saved)
  expect(await readdir(modelSecretDirectory(root))).toEqual(privateFiles)
  expect(await readConnectionKey(root, saved.connections.openai, new AbortController().signal)).toBe('new-synthetic-token')
})

it('refuses broad modes, symlinks and interrupted locks without changing existing access', async () => {
  const root = await profile(); const directory = modelSecretDirectory(root); await saveModelApiSettings(root, edit())
  await chmod(directory, 0o755); await expect(saveModelApiSettings(root, edit())).rejects.toThrow('private'); expect((await stat(directory)).mode & 0o777).toBe(0o755)
  await chmod(directory, 0o700); await writeFile(join(directory, 'settings.lock'), '', { mode: 0o600 }); await expect(saveModelApiSettings(root, edit())).rejects.toThrow('lock')
  const alias = join(root, 'alias'); await symlink(directory, alias); await expect(assertPrivatePath(alias, true)).rejects.toThrow('symbolic')
  expect(await readConnectionKey(root, { ...defaultModelApiConfig().connections.openai, authentication: 'none', credential: { type: 'external', path: '/does-not-exist' } }, new AbortController().signal)).toBeUndefined()
})

it('refreshes on each call, snapshots exact versions and fails newest without fallback or retry', async () => {
  const root = await profile(); const input = edit(); input.connections.openai.format = 'responses'; await saveModelApiSettings(root, input)
  let newest = 'gpt-6.1-sol'; let fail = false; const requests: { url: string, model?: string }[] = []
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.headers).not.toHaveProperty('authorization')
    if (String(url).endsWith('/models')) { requests.push({ url: String(url) }); return Response.json({ data: [{ id: 'gpt-6-sol' }, { id: newest }] }) }
    const model = JSON.parse(String(init?.body)).model as string; requests.push({ url: String(url), model })
    return fail ? Response.json({ error: { code: 'thinking_not_supported' } }, { status: 400 }) : Response.json(reply(model))
  }) as typeof fetch
  const manager = new AgentBackendManager({ profileRoot: root, fetch: fetcher }); await manager.reload()
  const first = await manager.run(request()); newest = 'gpt-6.2-sol'
  const second = await manager.run(request()); expect(first.metadata.modelId).toBe('gpt-6.1-sol'); expect(second.metadata.modelId).toBe(newest)
  expect(second.metadata).toMatchObject({ modelSelection: 'latest-family', connectionId: 'openai', apiFormat: 'responses', modelFamily: 'sol', resolverVersion: '1' })
  expect(second.metadata.catalogHash).not.toBe(first.metadata.catalogHash)
  fail = true; await expect(manager.run(request({ thinking: 'xhigh' }))).rejects.toMatchObject({ metadata: { modelId: newest, status: 'failed' } })
  expect(requests.filter(item => item.model).map(item => item.model)).toEqual(['gpt-6.1-sol', 'gpt-6.2-sol', 'gpt-6.2-sol'])
  expect(requests.filter(item => item.url.endsWith('/models'))).toHaveLength(3)
  await manager.drain()
})

it('reads native Messages catalog pagination and rejects partial or unauthorized catalogs', async () => {
  const connection = { ...defaultModelApiConfig().connections.anthropic, enabled: true, authentication: 'token' as const }
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ 'x-api-key': 'synthetic', 'anthropic-version': '2023-06-01' }); expect(init?.headers).not.toHaveProperty('authorization')
    return fetcher.mock.calls.length === 1 ? Response.json({ data: [{ id: 'claude-opus-5' }], has_more: true, last_id: 'claude-opus-5' }) : Response.json({ data: [{ id: 'claude-opus-5-5' }], has_more: false })
  })
  const value = await readModelCatalog(connection, 'synthetic', new AbortController().signal, fetcher as typeof fetch)
  expect(value.entries).toHaveLength(2); expect(String(fetcher.mock.calls[1][0])).toContain('after_id=claude-opus-5')
  await expect(readModelCatalog(connection, 'synthetic', new AbortController().signal, vi.fn(async () => Response.json({ data: [], has_more: true })) as typeof fetch)).rejects.toThrow('pagination')
  await expect(readModelCatalog(connection, 'synthetic', new AbortController().signal, vi.fn(async () => new Response('', { status: 401 })) as typeof fetch)).rejects.toMatchObject({ code: 'proxy_unauthorized', details: { phase: 'resolve' } })
})

it('keeps active calls on their snapshot and cancels only the disabled connection', async () => {
  const root = await profile(); const input = edit(); input.connections.openai.format = 'responses'; await saveModelApiSettings(root, input)
  let started: () => void = () => undefined; const dispatched = new Promise<void>((resolve) => { started = resolve })
  let latest = 'gpt-6.1-sol'
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: latest }] })
    const model = JSON.parse(String(init?.body)).model as string
    started()
    if (model === 'gpt-6.1-sol') return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }) })
    return Response.json(reply(model))
  }) as typeof fetch
  const manager = new AgentBackendManager({ profileRoot: root, fetch: fetcher }); await manager.reload()
  const active = manager.run(request()).catch(error => error); await dispatched
  latest = 'gpt-6.2-sol'
  const second = await manager.run(request()); expect(second.metadata.modelId).toBe(latest)
  input.expectedHash = manager.status().hash ?? null; input.connections.anthropic.enabled = false
  await manager.save(input)
  expect(fetcher).toHaveBeenCalledTimes(4)
  input.expectedHash = manager.status().hash ?? null; input.connections.openai.enabled = false
  await manager.save(input)
  expect(await active).toMatchObject({ code: 'cancelled', metadata: { modelId: 'gpt-6.1-sol', status: 'cancelled' } })
  await manager.drain()
})

it('cancels a catalog fetch before dispatch and leaves a single terminal failure', async () => {
  const root = await profile(); await saveModelApiSettings(root, edit())
  let began: () => void = () => undefined; const started = new Promise<void>((resolve) => { began = resolve })
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { began(); return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }) }) }) as typeof fetch
  const manager = new AgentBackendManager({ profileRoot: root, fetch: fetcher }); await manager.reload()
  const abort = new AbortController(); const events: string[] = []
  const running = manager.run(request(), { signal: abort.signal, onMetadata: value => events.push(value.status) }).catch(error => error)
  await started; abort.abort()
  expect(await running).toMatchObject({ code: 'cancelled', details: { phase: 'resolve' } })
  expect(fetcher).toHaveBeenCalledTimes(1); expect(events).toEqual(['cancelled']); await manager.drain()
})

it('rejects schema-2 credential paths and private backups from assigned resources and portable backup manifests', async () => {
  const { setMandatorySecretPaths, assertNotSecretPath } = await import('../../src/runtime/secret-paths')
  const { parseBackupManifest } = await import('../../src/worker/data/backup')
  const root = await profile(); const manager = new AgentBackendManager({ profileRoot: root }); await manager.reload()
  setMandatorySecretPaths(manager.protectedPaths())
  try {
    for (const name of ['token.json', 'future.config.tmp', 'saved.backup.json', 'settings.lock']) expect(() => assertNotSecretPath(join(modelSecretDirectory(root), name))).toThrow('cannot be assigned')
    expect(() => parseBackupManifest({ format: 'openape-pods-backup', version: 1, schema: 54, createdAt: new Date().toISOString(), sourceRoot: root, files: [{ path: 'model-api-private/key.json', size: 3, hash: 'a'.repeat(64) }] })).toThrow('Invalid backup')
  }
  finally { setMandatorySecretPaths([]); await manager.drain() }
})

it('keeps the committed configuration valid when a later credential fails and supports paired rollback', async () => {
  const root = await profile(); const original = await saveModelApiSettings(root, edit()); const path = join(root, 'agent-backends.json'); const bytes = await readFile(path, 'utf8')
  const input = edit(); input.expectedHash = configurationHash(original); input.connections.openai.authentication = 'token'; input.connections.openai.token = 'synthetic-new'; input.connections.anthropic.authentication = 'token'
  await expect(saveModelApiSettings(root, input)).rejects.toThrow('Enter an API token')
  expect(await readFile(path, 'utf8')).toBe(bytes)
  expect(await readdir(modelSecretDirectory(root))).not.toContain('settings.lock')
  input.connections.anthropic.authentication = 'none'
  const saved = await saveModelApiSettings(root, input)
  const backups = (await readdir(modelSecretDirectory(root))).filter(file => file.endsWith('.backup.json'))
  expect(backups).toHaveLength(1)
  expect(JSON.parse(await readFile(join(modelSecretDirectory(root), backups[0]), 'utf8'))).toEqual(original)
  await writeFile(path, bytes, { mode: 0o600 })
  const manager = new AgentBackendManager({ profileRoot: root }); expect((await manager.reload()).hash).toBe(configurationHash(original))
  expect(saved.connections.openai.credential?.type).toBe('managed'); await manager.drain()
})

it.skipIf(process.platform !== 'darwin')('rejects grant ACLs and writable ancestors without modifying them', async () => {
  const root = await profile(); await saveModelApiSettings(root, edit()); const path = join(root, 'agent-backends.json')
  const execute = promisify(execFile)
  await execute('/bin/chmod', ['+a', 'everyone allow read', path])
  await expect(assertPrivatePath(path)).rejects.toThrow('ACL')
  await execute('/bin/chmod', ['-N', path]); await chmod(root, 0o720)
  await expect(assertPrivatePath(path)).rejects.toThrow('ancestor'); await chmod(root, 0o700)
})
