import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentCallError, safeSystemCause } from '../../contracts/agent-errors'
import { modelApiIds, parseModelApiSave } from '../../contracts/model-api'
import type { ModelApiSave } from '../../contracts/model-api'
import { configurationHash, validateProxyBaseUrl } from './config'
import { defaultModelApiConfig, parseModelApiConfig, providerConnection } from './model-config'
import { readPrivateJson, readProxyKey } from './private-file'
import type { ModelApiConfig, ModelApiConnection } from './types'

const execute = promisify(execFile)
export function modelSecretDirectory(root: string): string { return join(root, 'model-api-private') }
export function credentialPath(root: string, connection: ModelApiConnection): string | undefined {
  const ref = connection.credential
  return ref?.type === 'external' ? ref.path : ref ? join(modelSecretDirectory(root), `${ref.id}.json`) : undefined
}
function unsafe(message: string): never { throw new AgentCallError('credential_unavailable', message, { phase: 'resolve' }) }
async function checkAcl(path: string, leaf: boolean, signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'darwin') return
  const { stdout } = await execute('/bin/ls', ['-lde', path], { maxBuffer: 16384, timeout: 2000, signal })
  if (stdout.split('\n').slice(1).some(line => /\ballow\b/.test(line) && (leaf || /write|append|add_file|add_subdirectory|delete_child|chown/.test(line)))) unsafe('Model API storage has an access-granting ACL')
}
export async function assertPrivatePath(path: string, directory = false, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const absolute = resolve(path)
  if (await realpath(absolute) !== absolute) unsafe('Model API paths must not contain symbolic links')
  let parent = directory ? absolute : dirname(absolute)
  while (true) {
    const info = await lstat(parent)
    if (!info.isDirectory() || info.isSymbolicLink() || ![0, process.getuid?.()].includes(info.uid) || ((info.mode & 0o022) && !(info.uid === 0 && info.mode & 0o1000))) unsafe('Model API path has an unsafe ancestor')
    await checkAcl(parent, parent === absolute, signal)
    if (parent === parse(parent).root) break
    parent = dirname(parent)
  }
  const info = await lstat(absolute)
  if (info.uid !== process.getuid?.() || (info.mode & 0o077) || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) unsafe('Model API storage must be private and owned by this user')
  if (!directory) await checkAcl(absolute, true, signal)
  signal?.throwIfAborted()
}
export async function readConnectionKey(root: string, connection: ModelApiConnection, signal: AbortSignal): Promise<string | undefined> {
  if (connection.authentication === 'none') return undefined
  const path = credentialPath(root, connection)
  if (!path) unsafe('An API token is required')
  await assertPrivatePath(path, false, signal)
  return readProxyKey(path, signal)
}
async function writeExclusive(path: string, value: unknown): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync() }
  finally { await file.close() }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try { await handle.sync() }
  finally { await handle.close() }
}
async function currentConfiguration(path: string): Promise<unknown | undefined> {
  try { return await readPrivateJson(path, 'configuration') }
  catch (error) {
    if (error instanceof AgentCallError && error.details.cause === 'ENOENT') return undefined
    throw error
  }
}
export async function saveModelApiSettings(root: string, input: ModelApiSave): Promise<ModelApiConfig> {
  const edit = parseModelApiSave(input)
  for (const id of modelApiIds) validateProxyBaseUrl(edit.connections[id].baseUrl)
  const directory = modelSecretDirectory(root)
  await mkdir(directory, { recursive: true, mode: 0o700 }); await assertPrivatePath(directory, true)
  const lockPath = join(directory, 'settings.lock')
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) }
  catch (error) { throw new AgentCallError('proxy_not_configured', 'Model API settings lock could not be acquired; inspect the previous save', { phase: 'resolve', cause: safeSystemCause(error) === 'EEXIST' ? 'configuration_locked' : safeSystemCause(error) }) }
  const path = join(root, 'agent-backends.json'); let temporary: string | undefined
  try {
    const raw = await currentConfiguration(path)
    if (raw !== undefined) await assertPrivatePath(path)
    const previous = raw === undefined ? defaultModelApiConfig() : parseModelApiConfig(raw)
    const hash = raw === undefined ? null : configurationHash(previous)
    if (hash !== edit.expectedHash) throw new AgentCallError('proxy_not_configured', 'Model API configuration changed; reload before saving', { phase: 'resolve', cause: 'configuration_changed' })
    const next = structuredClone(previous)
    for (const id of modelApiIds) {
      const entry = edit.connections[id]; const { token, ...settings } = entry
      let credential = entry.authentication === 'none' ? undefined : previous.connections[id].credential
      if (token) {
        const credentialId = randomUUID()
        await writeExclusive(join(directory, `${credentialId}.json`), { api_key: token })
        credential = { type: 'managed', id: credentialId }
      }
      next.connections[id] = { id, ...settings, baseUrl: validateProxyBaseUrl(entry.baseUrl), ...(credential ? { credential } : {}) }
      if (entry.enabled && entry.authentication === 'token' && !credential) unsafe('Enter an API token before enabling this connection')
      for (const provider of ['claude', 'codex'] as const) {
        if (providerConnection[provider] !== id) continue
        if (entry.defaultThinking !== previous.connections[id].defaultThinking) {
          for (const policy of Object.values(next.models[provider])) policy.defaultThinking = entry.defaultThinking
        }
      }
    }
    parseModelApiConfig(next)
    if (configurationHash(previous) === configurationHash(next) && raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === 2) return previous
    next.revision = randomUUID()
    if (raw !== undefined) await writeExclusive(join(directory, `${randomUUID()}.backup.json`), raw)
    temporary = join(directory, `${randomUUID()}.config.tmp`)
    await writeExclusive(temporary, next)
    const current = await currentConfiguration(path)
    if ((current === undefined ? null : configurationHash(parseModelApiConfig(current))) !== hash) throw new AgentCallError('proxy_not_configured', 'Model API configuration changed during save', { phase: 'resolve', cause: 'configuration_changed' })
    if (current !== undefined) await assertPrivatePath(path)
    await syncDirectory(directory)
    await rename(temporary, path); temporary = undefined
    await syncDirectory(root)
    return next
  }
  finally {
    if (temporary) await rm(temporary, { force: true })
    await lock.close(); await rm(lockPath)
  }
}
