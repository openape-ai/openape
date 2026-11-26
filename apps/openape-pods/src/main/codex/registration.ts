import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import type { CodexConnection } from '../../contracts/codex'
import { writeLauncher } from './launcher'
import type { LauncherTarget } from './launcher'

const name = 'openape-pods'
const manual = `codex mcp remove ${name}`
interface Receipt { config: string, appended: string, created: boolean }

// Registers the launcher with the owner's Codex. The Codex CLI writer rewrote
// unrelated parts of config.toml in the issue 1375 probe, so the app appends one
// marked block itself and removes exactly those bytes again; it only reads the
// file otherwise. Entries it did not write are never changed.
export class CodexRegistration {
  constructor(private readonly home: string, private readonly directory: string, private readonly target: LauncherTarget) {}
  get launcher(): string { return join(this.directory, 'openape-pods-mcp') }
  private get record(): string { return join(this.directory, 'registration.json') }
  private get config(): string { return join(this.home, 'config.toml') }

  async status(): Promise<CodexConnection> {
    const entry = await this.entry()
    if (!entry) return { state: 'disconnected', home: this.home, manual }
    return { state: entry === this.launcher ? 'connected' : 'foreign', home: this.home, manual }
  }

  async connect(): Promise<CodexConnection> {
    const entry = await this.entry()
    if (entry && entry !== this.launcher) return { state: 'foreign', home: this.home, manual }
    await writeLauncher(this.launcher, this.target)
    if (entry) return { state: 'connected', home: this.home, manual }
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    const original = await readFile(this.config, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    const appended = `${original && !original.endsWith('\n') ? '\n' : ''}\n# Added by OpenApe Pods. Remove it in the app or with: ${manual}\n[mcp_servers.${name}]\ncommand = ${JSON.stringify(this.launcher)}\ntool_timeout_sec = 180\n`
    await this.write((original ?? '') + appended)
    if (await this.entry().catch(() => null) !== this.launcher) {
      if (original === null) await rm(this.config, { force: true })
      else await this.write(original)
      throw new Error('Codex did not accept the OpenApe Pods entry; its configuration was restored')
    }
    await writeFile(this.record, JSON.stringify({ config: this.config, appended, created: original === null } satisfies Receipt), { mode: 0o600 })
    return { state: 'connected', home: this.home, manual }
  }

  async disconnect(): Promise<CodexConnection> {
    const record = await readFile(this.record, 'utf8').then(value => JSON.parse(value) as Receipt, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    const current = record ? await readFile(record.config, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error }) : ''
    if (record && current.endsWith(record.appended)) {
      const remaining = current.slice(0, -record.appended.length)
      if (record.created && !remaining) await rm(record.config, { force: true })
      else await this.write(remaining)
    }
    const state = await this.status()
    if (state.state === 'connected') return { ...state, state: 'edited' }
    await rm(this.record, { force: true }); await rm(this.launcher, { force: true })
    return state
  }

  private async write(content: string): Promise<void> {
    const mode = await stat(this.config).then(info => info.mode & 0o777, () => 0o600)
    await writeFile(`${this.config}.openape-pods.tmp`, content, { mode }); await rename(`${this.config}.openape-pods.tmp`, this.config)
  }

  /** The registered launcher command, 'unsupported' for any other transport, or null without an entry. */
  private async entry(): Promise<string | null> {
    const text = await readFile(this.config, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    if (text === null) return null
    let servers: unknown
    try { servers = parse(text).mcp_servers }
    catch (error) { throw new Error('Codex configuration could not be read; check config.toml', { cause: error }) }
    const server = servers && typeof servers === 'object' ? (servers as Record<string, unknown>)[name] : undefined
    if (server === undefined) return null
    const { command, args, url } = (server && typeof server === 'object' ? server : {}) as { command?: unknown, args?: unknown, url?: unknown }
    return typeof command === 'string' && url === undefined && (args === undefined || (Array.isArray(args) && !args.length)) ? command : 'unsupported'
  }
}
